"""Optional, pinned-source restoration. HTTPS/proxy/TLS verification stays enabled."""
from pathlib import Path
import io,json,hashlib,urllib.request
from PIL import Image
root=Path(__file__).resolve().parents[1]
records=json.loads((root/'tools/external-assets.json').read_text())
sha=lambda b:hashlib.sha256(b).hexdigest()
for r in records:
 dest=root/'public'/r['target']
 if dest.exists() and sha(dest.read_bytes())==r['targetSha256']:
  print('verified',r['target']);continue
 with urllib.request.urlopen(r['url'],timeout=60) as response:data=response.read()
 if sha(data)!=r['sourceSha256']:raise ValueError('Source checksum mismatch: '+r['target'])
 if 'jpegQuality' in r:
  output=io.BytesIO();Image.open(io.BytesIO(data)).save(output,format='JPEG',quality=r['jpegQuality']);data=output.getvalue()
 if sha(data)!=r['targetSha256']:raise ValueError('Output checksum mismatch; check pinned Pillow/libjpeg versions: '+r['target'])
 dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data);print('restored',r['target'])
