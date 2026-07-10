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

def scan_model_file(filepath: Path) -> bool:
    """
    Scans a PyTorch (.pth or .pt) model file to verify it doesn't contain
    malicious pickle bytecode that could execute arbitrary commands.
    """
    import zipfile
    import pickletools

    # Allowed modules/packages for standard PyTorch model weights
    SAFE_MODULES = {
        'torch',
        'torch._utils',
        'collections',
        'numpy',
        'numpy.core.multiarray',
        '_codecs',
    }
    
    # Allowed specific names from builtins
    SAFE_BUILTINS = {'dict', 'list', 'set', 'tuple', 'bool', 'int', 'float', 'str', 'bytes'}

    if not filepath.exists():
        print(f"Safety scan: File {filepath} does not exist.")
        return False

    def scan_pickle_data(data_bytes: bytes) -> bool:
        try:
            for opcode, args, pos in pickletools.genops(data_bytes):
                if opcode.name == 'GLOBAL':
                    module, name = args.split(' ')
                    if module == 'builtins' or module == '__builtin__':
                        if name not in SAFE_BUILTINS:
                            print(f"\nSafety scan WARNING: Blocked loading file due to suspicious builtin '{module}.{name}'.")
                            return False
                    elif module not in SAFE_MODULES and not module.startswith('torch.') and not module.startswith('fairseq.') and module != 'fairseq':
                        print(f"\nSafety scan WARNING: Blocked loading file due to suspicious pickle import '{module}.{name}' at position {pos}.")
                        return False
            return True
        except Exception as e:
            print(f"\nSafety scan: Error parsing pickle bytecode: {e}")
            return False

    # Standard PyTorch models can be raw pickles or Zip archives
    if zipfile.is_zipfile(filepath):
        try:
            with zipfile.ZipFile(filepath, 'r') as zip_ref:
                has_pickle = False
                for file_info in zip_ref.infolist():
                    if file_info.filename.endswith('.pkl') or 'data.pkl' in file_info.filename:
                        has_pickle = True
                        data = zip_ref.read(file_info.filename)
                        if not scan_pickle_data(data):
                            return False
                if not has_pickle:
                    print(f"Safety scan: ZIP file {filepath.name} has no .pkl files, assuming safe (e.g. state dict or ONNX).")
                return True
        except Exception as e:
            print(f"Safety scan: Failed to read ZIP archive: {e}")
            return False
    else:
        try:
            with open(filepath, 'rb') as f:
                data = f.read()
            return scan_pickle_data(data)
        except Exception as e:
            print(f"Safety scan: Failed to read file: {e}")
            return False

def main():
    for name, url in MODELS.items():
        dest = RVC_DIR / name
        if dest.exists() and dest.stat().st_size > 1000000:
            print(f"{name} already exists in storage. Scanning for safety...")
            if not scan_model_file(dest):
                print(f"CRITICAL WARNING: Existing model file {name} failed safety scan! Deleting it.")
                try:
                    dest.unlink()
                except Exception as e:
                    print(f"Failed to delete unsafe file {dest}: {e}")
            else:
                print(f"{name} safety scan passed.")
        else:
            download_with_progress(url, dest)
            if dest.exists():
                print(f"Scanning downloaded model {name} for safety...")
                if not scan_model_file(dest):
                    print(f"CRITICAL WARNING: Downloaded model file {name} failed safety scan! Deleting it.")
                    try:
                        dest.unlink()
                    except Exception as e:
                        print(f"Failed to delete unsafe file {dest}: {e}")
                else:
                    print(f"{name} safety scan passed.")

if __name__ == '__main__':
    main()

