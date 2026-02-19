import os, re, subprocess, datetime, pathlib, yaml
from dotenv import load_dotenv

from providers.openai_compat import chat as openai_chat
from providers.anthropic import chat as anthropic_chat

ROOT = pathlib.Path(__file__).resolve().parents[1]
LOGS = ROOT / 'logs'

def run(cmd, check=True, capture=False, shell=False):
    return subprocess.run(cmd, cwd=ROOT, check=check, text=True,
                          capture_output=capture, shell=shell)

def log(name: str, content: str):
    LOGS.mkdir(exist_ok=True)
    ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    (LOGS / f'{ts}-{name}.md').write_text(content, encoding='utf-8')

def read_text(p: pathlib.Path) -> str:
    return p.read_text(encoding='utf-8') if p.exists() else ''

def get_repo_context():
    status = run(['git','status','--porcelain'], capture=True).stdout.strip()
    head = run(['git','rev-parse','--abbrev-ref','HEAD'], capture=True).stdout.strip()
    diff = run(['git','diff'], capture=True).stdout
    return status, head, diff[:12000]

def load_prompt(role: str) -> str:
    return read_text(ROOT / 'agent' / 'prompts' / f'{role}.md')

def call_agent(cfg, role: str, mission: str, extra: str = '') -> str:
    role_cfg = cfg['models'][role]
    provider_name = role_cfg['provider']
    model = role_cfg['model']

    prov = cfg['providers'][provider_name]
    base_url = prov['base_url']
    api_key = os.getenv(prov['api_key_env'], '')
    if not api_key:
        raise RuntimeError(f'Missing env: {prov['api_key_env']}')

    system = load_prompt(role)
    status, head, diff = get_repo_context()

    messages = [
        {'role':'system','content':system},
        {'role':'user','content':
            f'MISSION:\\n{mission}\\n\\n'
            f'REPO_HEAD: {head}\\n'
            f'STATUS:\\n{status or '(clean)'}\\n\\n'
            f'DIFF (truncated):\\n{diff}\\n\\n'
            f'{extra}'
        }
    ]

    if provider_name == 'anthropic':
        return anthropic_chat(base_url, api_key, model, messages, anthropic_version=prov.get('anthropic_version','2023-06-01'))
    else:
        return openai_chat(base_url, api_key, model, messages)

def extract_patch(text: str):
    m = re.search(r'PATCH:\\s*(.*)', text, flags=re.DOTALL)
    if not m:
        return None
    patch = m.group(1).strip()
    if 'diff --git' not in patch:
        return None
    return patch + '\\n'

def ensure_clean():
    st = run(['git','status','--porcelain'], capture=True).stdout.strip()
    if st:
        raise RuntimeError('Working tree not clean. 커밋/스태시 후 다시 실행.')

def apply_patch(patch: str) -> bool:
    p = ROOT / '.agent.patch'
    p.write_text(patch, encoding='utf-8')
    try:
        run(['git','apply','.agent.patch'], check=True)
        return True
    except subprocess.CalledProcessError:
        return False

def run_gate(cmds):
    for c in cmds:
        print(f'$ {c}')
        try:
            run(c, shell=True, check=True)
        except subprocess.CalledProcessError:
            return False
    return True

def slug(mission: str) -> str:
    s = re.sub(r'[^a-zA-Z0-9]+','-', mission.strip().lower())[:40].strip('-')
    ts = datetime.datetime.now().strftime('%m%d-%H%M')
    return f'{ts}-{s or 'change'}'

def main():
    import sys
    load_dotenv()
    cfg = yaml.safe_load(read_text(ROOT / 'agent' / 'config.yml'))
    mission = ' '.join(sys.argv[1:]).strip()
    if not mission:
        raise SystemExit('Usage: python agent/orchestrator.py \"<MISSION>\"')

    ensure_clean()

    base = cfg['repo'].get('base_branch','main')
    prefix = cfg['repo'].get('branch_prefix','agent')
    loops = int(cfg['repo'].get('max_loops',4))
    draft = bool(cfg['repo'].get('create_draft_pr', True))
    gate_cmds = cfg['gate']['commands']

    run(['git','checkout',base])
    run(['git','pull'])
    br = f'{prefix}/{slug(mission)}'
    run(['git','checkout','-b',br])

    plan = call_agent(cfg,'planner',mission)
    log('planner',plan)
    arch = call_agent(cfg,'architect',mission, extra=f'\\n\\nPLANNER_OUTPUT:\\n{plan}')
    log('architect',arch)

    extra = f'\\n\\nPLANNER_OUTPUT:\\n{plan}\\n\\nARCH_OUTPUT:\\n{arch}\\n'

    for i in range(1, loops+1):
        impl = call_agent(cfg,'implementer',mission, extra=extra)
        log(f'implementer-{i}',impl)
        patch = extract_patch(impl)
        if not patch or not apply_patch(patch):
            fix = call_agent(cfg,'fixer',mission, extra=extra + '\\n\\n(Apply failed or no PATCH) Return corrected PATCH.')
            log(f'fixer-apply-{i}',fix)
            patch2 = extract_patch(fix)
            if not patch2 or not apply_patch(patch2):
                continue

        rev = call_agent(cfg,'reviewer',mission, extra=extra + '\\n\\nReview current changes. If fix needed, output PATCH.')
        log(f'reviewer-{i}',rev)
        rpatch = extract_patch(rev)
        if rpatch:
            if not apply_patch(rpatch):
                continue

        if run_gate(gate_cmds):
            run(['git','add','-A'])
            run(['git','commit','-m', f'agent: {mission[:60]}'])
            run(['git','push','-u','origin',br])

            title = f'[agent] {mission[:80]}'
            body = f'{mission}\\n\\n---\\nPlanner:\\n{plan}\\n\\nArchitect:\\n{arch}\\n'
            cmd = ['gh','pr','create','--title',title,'--body',body,'--base',base]
            if draft:
                cmd.append('--draft')
            run(cmd)
            print('✅ PR created')
            return

        # gate 실패하면 fixer loop
        fix = call_agent(cfg,'fixer',mission, extra=extra + '\\n\\nGate failed (lint/build). Fix and output PATCH only.')
        log(f'fixer-gate-{i}',fix)
        patch3 = extract_patch(fix)
        if patch3:
            apply_patch(patch3)

    raise RuntimeError('Max loops reached without passing gate.')

if __name__ == '__main__':
    main()
