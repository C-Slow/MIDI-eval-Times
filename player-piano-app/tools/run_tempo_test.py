import sys, os
from pathlib import Path

# Set up project paths
project_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(project_root / 'player-piano-app'))

from app import utils

# Local test parameters (change as needed)
inp = str(project_root / 'storage' / 'raw' / 'to-zanakand.mid')
out = str(project_root / 'storage' / 'processed' / 'to-zanakand-tempo0.8.mid')
print('Running tempo...')
utils.run_tempo(inp, out, 0.8)
print('exists?', os.path.exists(out))
print('size:', os.path.getsize(out) if os.path.exists(out) else 'N/A')
