import requests

def chat(base_url: str, api_key: str, model: str, messages: list[dict], anthropic_version='2023-06-01', timeout=120):
    url = base_url.rstrip('/') + '/v1/messages'
    headers = {
        'Content-Type': 'application/json',
        'x-api-key': api_key,
        'anthropic-version': anthropic_version,
    }

    system_text = ''
    converted = []
    for m in messages:
        if m['role'] == 'system':
            system_text += m['content'] + '\n'
        else:
            converted.append({'role': m['role'], 'content': m['content']})

    payload = {
        'model': model,
        'max_tokens': 4096,
        'messages': converted,
    }
    if system_text.strip():
        payload['system'] = system_text.strip()

    r = requests.post(url, headers=headers, json=payload, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    return ''.join([b.get('text','') for b in data.get('content', [])])
