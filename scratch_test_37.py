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
        {"role": "user", "content": "Hola"}
    ]
}

r = requests.post(url, headers=headers, json=payload)
print("gemini-3.7-flash simple status:", r.status_code)
print("gemini-3.7-flash simple body:", r.text)
