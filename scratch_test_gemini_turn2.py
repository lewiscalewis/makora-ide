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

# Let's test a turn 1 with streaming (like Makora does), and then turn 2 with streaming (like Makora does)!
system_prompt = "Eres un asistente de programación."
user_msg = "Revisa el código de main.py"

payload1 = {
    "model": "gemini-3.6-flash",
    "messages": [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_msg}
    ],
    "tools": [
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Lee el contenido de un archivo",
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
    "tool_choice": "auto",
    "stream": True
}

r1 = requests.post(url, headers=headers, json=payload1, stream=True)
tcs = {}
assistant_text = ""
for line in r1.iter_lines():
    if line:
        decoded = line.decode('utf-8')
        if decoded.startswith('data: '):
            data_str = decoded[6:]
            if data_str != '[DONE]':
                v = json.loads(data_str)
                for choice in v.get("choices", []):
                    delta = choice.get("delta", {})
                    if delta.get("content"):
                        assistant_text += delta["content"]
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

print("Turn 1 assistant text:", assistant_text)
print("Turn 1 tcs:", json.dumps(tcs, indent=2))

# Now build Turn 2 exactly how gateway.rs to_wire does it:
msgs = [
    {"role": "system", "content": system_prompt},
    {"role": "user", "content": user_msg},
]

# Assistant message with tool_calls:
tool_calls_arr = []
for i, (idx, tc) in enumerate(tcs.items()):
    tc_obj = {
        "id": tc["id"] if tc["id"] else f"call_{i}",
        "type": "function",
        "function": {
            "name": tc["name"],
            "arguments": tc["arguments"]
        }
    }
    if tc["extra_content"]:
        tc_obj["extra_content"] = tc["extra_content"]
    tool_calls_arr.append(tc_obj)

assistant_wire = {
    "role": "assistant",
    "content": None if not assistant_text else assistant_text,
    "tool_calls": tool_calls_arr
}
msgs.append(assistant_wire)

# Tool response message:
for tc in tool_calls_arr:
    tool_wire = {
        "role": "tool",
        "content": "ERROR: [WinError 2] El sistema no puede encontrar el archivo especificado: 'C:\\\\Users\\\\lewis\\\\Projects\\\\ai_quant_trading\\\\main.py'",
        "tool_call_id": tc["id"]
    }
    msgs.append(tool_wire)

print("Turn 2 payload messages:")
print(json.dumps(msgs, indent=2))

payload2 = {
    "model": "gemini-3.6-flash",
    "messages": msgs,
    "tools": payload1["tools"],
    "tool_choice": "auto",
    "stream": True
}

r2 = requests.post(url, headers=headers, json=payload2, stream=True)
print("Turn 2 status code:", r2.status_code)
if r2.status_code != 200:
    print("Turn 2 error body:", r2.text)
else:
    for line in r2.iter_lines():
        if line:
            print("Stream line:", line.decode('utf-8')[:120])
