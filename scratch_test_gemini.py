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

# Turn 1
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
    "stream": False
}

r1 = requests.post(url, headers=headers, json=payload1)
print("Turn 1 (non-stream) status:", r1.status_code)
msg1 = r1.json()['choices'][0]['message']
print("Turn 1 assistant message:", json.dumps(msg1, indent=2))

# Turn 2: send back msg1 and the tool result
payload2 = {
    "model": "gemini-3.6-flash",
    "messages": [
        {"role": "user", "content": "Lee el archivo test.txt"},
        msg1,
        {
            "role": "tool",
            "content": "ERROR: Archivo no encontrado",
            "tool_call_id": msg1['tool_calls'][0]['id']
        }
    ],
    "tools": payload1["tools"],
    "stream": False
}

r2 = requests.post(url, headers=headers, json=payload2)
print("Turn 2 status:", r2.status_code)
print("Turn 2 body:", r2.text)
