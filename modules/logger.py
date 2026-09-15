# Standardized ANSI Colored Logger for ComfyUI-Autocomplete-Plus-Plus
import sys

def _init_ansi() -> bool:
    if sys.platform == "win32":
        try:
            import ctypes
            kernel32 = ctypes.windll.kernel32
            handle = kernel32.GetStdHandle(-11)
            mode = ctypes.c_ulong()
            if kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
                return bool(kernel32.SetConsoleMode(handle, mode.value | 0x0004))
        except Exception:
            pass
        return False
    return hasattr(sys.stdout, "isatty") and sys.stdout.isatty()

_has_color = _init_ansi()

COLOR_GREEN = "\033[92m" if _has_color else ""
COLOR_YELLOW = "\033[93m" if _has_color else ""
COLOR_RED = "\033[91m" if _has_color else ""
COLOR_CYAN = "\033[96m" if _has_color else ""
COLOR_RESET = "\033[0m" if _has_color else ""

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
