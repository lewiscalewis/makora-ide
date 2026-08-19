import os
import requests
import json
from dotenv import load_dotenv

load_dotenv(r'c:\Users\lewis\Projects\ai_quant_trading\.env')
api_key = os.getenv('GEMINI_API_KEY')

url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
headers = {
    "Authorization": f"Bearer {api_key}",
    "x-goog-api-key": api_key,
    "Content-Type": "application/json"
}

payload = {
    "model": "gemini-3.7-flash",
    "messages": [
        {"role": "user", "content": "Lee el archivo test.txt"}
    ],
    "tools": [
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}
            }
        }
    ],
    "stream": True
}

r = requests.post(url, headers=headers, json=payload, stream=True)
for i, line in enumerate(r.iter_lines()):
    if line:
        decoded = line.decode('utf-8')
        if decoded.startswith('data: '):
            data = decoded[6:]
            if data != '[DONE]':
                v = json.loads(data)
                print(f"--- Chunk {i} ---")
                print(json.dumps(v, indent=2))
