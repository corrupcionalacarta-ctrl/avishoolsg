import json, glob
from dotenv import load_dotenv
load_dotenv('.env')
from supabase_push import push_digest

for f in sorted(glob.glob('digest_*.json')):
    with open(f) as fp:
        d = json.load(fp)
    n = len(d.get('urgentes',[])) + len(d.get('importantes',[])) + len(d.get('informativos',[]))
    ok = push_digest(d, n, run_mode='morning')
    print(f, '->', 'OK' if ok else 'FALLO')
