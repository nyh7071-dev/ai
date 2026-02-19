import requests

def chat(base_url: str, api_key: str, model: str, messages: list[dict], timeout=120):
    url = base_url.rstrip('/') + '/chat/completions'
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {api_key}',
    }
    payload = {
        'model': model,
        'messages': messages,
        'temperature': 0.2,
    }
    r = requests.post(url, headers=headers, json=payload, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    return data['choices'][0]['message']['content']
