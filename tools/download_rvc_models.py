import os
import sys
import urllib.request
from pathlib import Path

STORAGE_DIR = Path(__file__).resolve().parents[1] / 'storage'
RVC_DIR = STORAGE_DIR / 'rvc_models'
RVC_DIR.mkdir(parents=True, exist_ok=True)

MODELS = {
    "hubert_base.pt": "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/hubert_base.pt",
    "female_singing.pth": "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/pretrained_v2/f0G40k.pth",
    "male_singing.pth": "https://huggingface.co/kevinwang676/RVC-models/resolve/main/syz.pth"
}

def download_with_progress(url, dest_path):
    print(f"Downloading {url} to {dest_path}...")
    
    def reporthook(blocknum, blocksize, totalsize):
        readsofar = blocknum * blocksize
        if totalsize > 0:
            percent = readsofar * 1e2 / totalsize
            s = f"\rProgress: {percent:3.1f}% ({readsofar / (1024*1024):.2f} MB / {totalsize / (1024*1024):.2f} MB)"
            sys.stdout.write(s)
            sys.stdout.flush()
        else:
            sys.stdout.write(f"\rProgress: {readsofar / (1024*1024):.2f} MB")
            sys.stdout.flush()

    try:
        urllib.request.urlretrieve(url, str(dest_path), reporthook)
        print("\nDownload complete successfully!")
    except Exception as e:
        print(f"\nDownload failed: {e}")
        if dest_path.exists():
            try:
                dest_path.unlink()
            except Exception:
                pass

def main():
    for name, url in MODELS.items():
        dest = RVC_DIR / name
        if dest.exists() and dest.stat().st_size > 1000000:
            print(f"{name} already exists in storage. Skipping.")
        else:
            download_with_progress(url, dest)

if __name__ == '__main__':
    main()
