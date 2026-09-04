# Standardized ANSI Colored Logger for ComfyUI-Autocomplete-Plus-Plus
import os
import sys

# Ensure ANSI virtual terminal escape sequences are enabled on Windows
if sys.platform == "win32":
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
    except Exception:
        os.system("")

COLOR_GREEN = "\033[92m"
COLOR_YELLOW = "\033[93m"
COLOR_RED = "\033[91m"
COLOR_CYAN = "\033[96m"
COLOR_RESET = "\033[0m"

TAG = "[ComfyUI-Autocomplete-Plus-Plus]"

def info(msg: str):
    """Outputs info log with green level tag."""
    print(f"{COLOR_GREEN}[INFO]{COLOR_RESET} {TAG} {msg}", flush=True)

def warning(msg: str):
    """Outputs warning log with yellow level tag."""
    print(f"{COLOR_YELLOW}[WARNING]{COLOR_RESET} {TAG} {msg}", flush=True)

def error(msg: str):
    """Outputs error log with red level tag."""
    print(f"{COLOR_RED}[ERROR]{COLOR_RESET} {TAG} {msg}", flush=True)

def debug(msg: str):
    """Outputs debug log with cyan level tag."""
    print(f"{COLOR_CYAN}[DEBUG]{COLOR_RESET} {TAG} {msg}", flush=True)
