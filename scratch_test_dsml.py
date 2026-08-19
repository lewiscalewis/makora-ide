import re
import json

sample_text = 'Voy a inspeccionar el estado del repositorio... < | DSML | tool_calls > < | DSML | invoke name="bash" > < | DSML | parameter name="command" string="true">python _deploy_vps.py build 2>&1</ | DSML | parameter > </ | DSML | invoke > </ | DSML | tool_calls >'

def parse_and_clean_dsml(text):
    tool_calls = []
    # Pattern for DSML invoke blocks
    invoke_pattern = re.compile(
        r'<\s*\|\s*DSML\s*\|\s*invoke\s+name=["\']([^"\']+)["\']\s*>(.*?)<\s*/\s*\|\s*DSML\s*\|\s*invoke\s*>',
        re.DOTALL
    )
    param_pattern = re.compile(
        r'<\s*\|\s*DSML\s*\|\s*parameter\s+name=["\']([^"\']+)["\'][^>]*>(.*?)<\s*/\s*\|\s*DSML\s*\|\s*parameter\s*>',
        re.DOTALL
    )

    for m in invoke_pattern.finditer(text):
        name = m.group(1).strip()
        body = m.group(2)
        args_dict = {}
        for pm in param_pattern.finditer(body):
            p_name = pm.group(1).strip()
            p_val = pm.group(2).strip()
            args_dict[p_name] = p_val
        tool_calls.append({
            "name": name,
            "arguments": json.dumps(args_dict)
        })

    # Pattern for <tool_call> JSON blocks
    tool_call_json_pattern = re.compile(r'<\s*tool_call\s*>(.*?)<\s*/\s*tool_call\s*>', re.DOTALL)
    for m in tool_call_json_pattern.finditer(text):
        try:
            parsed = json.loads(m.group(1).strip())
            if isinstance(parsed, dict) and "name" in parsed:
                args = parsed.get("arguments", {})
                tool_calls.append({
                    "name": parsed["name"],
                    "arguments": json.dumps(args) if isinstance(args, dict) else str(args)
                })
        except Exception:
            pass

    # Clean all DSML blocks completely from user-facing text
    clean_text = re.sub(r'<\s*\|\s*DSML\s*\|\s*tool_calls\s*>.*?<\s*/\s*\|\s*DSML\s*\|\s*tool_calls\s*>', '', text, flags=re.DOTALL)
    clean_text = re.sub(r'<\s*\|\s*DSML\s*\|\s*invoke.*?<\s*/\s*\|\s*DSML\s*\|\s*invoke\s*>', '', clean_text, flags=re.DOTALL)
    clean_text = re.sub(r'<\s*\|?\s*DSML\s*\|?.*?>', '', clean_text)
    clean_text = re.sub(r'<\s*/\s*\|?\s*DSML\s*\|?.*?>', '', clean_text)
    clean_text = re.sub(r'<\s*tool_call\s*>.*?<\s*/\s*tool_call\s*>', '', clean_text, flags=re.DOTALL)
    clean_text = clean_text.strip()
    return clean_text, tool_calls

clean, tcs = parse_and_clean_dsml(sample_text)
print("Clean text:", repr(clean))
print("Extracted tool calls:", tcs)
