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

payload1 = {
    "model": "gemini-3.6-flash",
    "messages": [
        {"role": "user", "content": "Lee el archivo test.txt"}
    ],
    "tools": [
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Lee un archivo",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"}
                    },
                    "required": ["path"]
                }
            }
        }
    ],
    "stream": True
}

r1 = requests.post(url, headers=headers, json=payload1, stream=True)
tcs = {}
for line in r1.iter_lines():
    if line:
        decoded = line.decode('utf-8')
        if decoded.startswith('data: '):
            data_str = decoded[6:]
            if data_str != '[DONE]':
                v = json.loads(data_str)
                for choice in v.get("choices", []):
                    delta = choice.get("delta", {})
                    for call in delta.get("tool_calls", []):
                        idx = call.get("index", 0)
                        if idx not in tcs:
                            tcs[idx] = {"id": "", "name": "", "arguments": "", "extra_content": None}
                        if call.get("id"):
                            tcs[idx]["id"] = call["id"]
                        if call.get("function", {}).get("name"):
                            tcs[idx]["name"] = call["function"]["name"]
                        if call.get("function", {}).get("arguments"):
                            tcs[idx]["arguments"] += call["function"]["arguments"]
                        if call.get("extra_content"):
                            tcs[idx]["extra_content"] = call["extra_content"]

print("Constructed Tool Calls from SSE:")
print(json.dumps(tcs, indent=2))
