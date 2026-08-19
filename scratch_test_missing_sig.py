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

# Turn 1: User -> Assistant (without extra_content) -> User 2
payload_without = {
    "model": "gemini-3.7-flash",
    "messages": [
        {"role": "user", "content": "Hola"},
        {"role": "assistant", "content": "¡Hola! ¿Cómo estás?"},
        {"role": "user", "content": "¿Qué puedes hacer?"}
    ]
}

r1 = requests.post(url, headers=headers, json=payload_without)
print("Turn 2 without extra_content on assistant:", r1.status_code)
if r1.status_code != 200:
    print(r1.text)

# Turn 1: User -> Assistant with Tool Call WITHOUT thought_signature -> Tool -> User
payload_tool_without_sig = {
    "model": "gemini-3.7-flash",
    "messages": [
        {"role": "user", "content": "Lee test.txt"},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_123",
                    "type": "function",
                    "function": {"name": "read_file", "arguments": "{\"path\":\"test.txt\"}"}
                }
            ]
        },
        {"role": "tool", "content": "ERROR: not found", "tool_call_id": "call_123"}
    ],
    "tools": [
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}
            }
        }
    ]
}

r2 = requests.post(url, headers=headers, json=payload_tool_without_sig)
print("Tool turn without thought_signature:", r2.status_code)
if r2.status_code != 200:
    print(r2.text)
