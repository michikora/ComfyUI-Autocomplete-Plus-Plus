from .modules.api import *
from .modules import logger

logger.info("ComfyUI-Autocomplete-Plus-Plus initialized successfully.")

WEB_DIRECTORY = "./web"


class AutocompletePlusController:
    """
    Autocomplete++ Wildcard & Dynamic Prompts Controller Node.
    Placed anywhere on the canvas to override global wildcard and dynamic prompts settings.
    No wiring required.
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "expansion_engine": (["Default (From Settings)", "Enabled", "Disabled"], {"default": "Default (From Settings)"}),
                "wildcard_mode": (["Default (From Settings)", "Random", "Follow Seed", "Keep Last Choice", "Sequential"], {"default": "Default (From Settings)"}),
                "dynamic_prompt_mode": (["Default (From Settings)", "Random", "Follow Seed", "Keep Last Choice"], {"default": "Default (From Settings)"}),
            },
            "optional": {
                "passthrough": ("*", {})
            }
        }

    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("passthrough",)
    FUNCTION = "execute"
    CATEGORY = "Autocomplete++"
    OUTPUT_NODE = True

    def execute(self, expansion_engine="Default (From Settings)", wildcard_mode="Default (From Settings)", dynamic_prompt_mode="Default (From Settings)", passthrough=None):
        return (passthrough,)


class AutocompletePlusFormattingController:
    """
    Autocomplete++ Formatting Controller Node.
    Placed anywhere on the canvas to override formatting, auto-formatting, and Anima artist mode settings.
    No wiring required.
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "anima_artist_mode": (["Default (From Settings)", "Enabled", "Disabled"], {"default": "Default (From Settings)"}),
                "auto_format_on_blur": (["Default (From Settings)", "Enabled", "Disabled"], {"default": "Default (From Settings)"}),
                "format_space_after_comma": (["Default (From Settings)", "Enabled", "Disabled"], {"default": "Default (From Settings)"}),
                "format_trim_prompt_end_comma": (["Default (From Settings)", "Enabled", "Disabled"], {"default": "Default (From Settings)"}),
                "format_trim_line_end_comma": (["Default (From Settings)", "Enabled", "Disabled"], {"default": "Default (From Settings)"}),
                "format_replace_underscore": (["Default (From Settings)", "Enabled", "Disabled"], {"default": "Default (From Settings)"}),
                "escape_parentheses": (["Default (From Settings)", "Enabled", "Disabled"], {"default": "Default (From Settings)"}),
                "auto_insert_comma": (["Default (From Settings)", "Enabled", "Disabled"], {"default": "Default (From Settings)"}),
                "replace_underscore": (["Default (From Settings)", "Enabled", "Disabled"], {"default": "Default (From Settings)"}),
                "keep_underscores_mode": (["Default (From Settings)", "Append to Global List", "Override Global List"], {"default": "Default (From Settings)"}),
                "keep_underscores_list": ("STRING", {"default": "", "multiline": True, "placeholder": "e.g. custom_tag, special_style..."}),
            },
            "optional": {
                "passthrough": ("*", {})
            }
        }

    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("passthrough",)
    FUNCTION = "execute"
    CATEGORY = "Autocomplete++"
    OUTPUT_NODE = True

    def execute(self, anima_artist_mode="Default (From Settings)", auto_format_on_blur="Default (From Settings)",
                format_space_after_comma="Default (From Settings)", format_trim_prompt_end_comma="Default (From Settings)",
                format_trim_line_end_comma="Default (From Settings)", format_replace_underscore="Default (From Settings)",
                escape_parentheses="Default (From Settings)", auto_insert_comma="Default (From Settings)",
                replace_underscore="Default (From Settings)", keep_underscores_mode="Default (From Settings)",
                keep_underscores_list="", passthrough=None):
        return (passthrough,)


class AutocompletePlusIntegrationsController:
    """
    Autocomplete++ Integrations Controller Node.
    Placed anywhere on the canvas to override LoRA/Embedding suggestions and LoRA Manager integration.
    No wiring required.
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "enable_lora_embedding": (["Default (From Settings)", "Enabled", "Disabled"], {"default": "Default (From Settings)"}),
                "lora_path_mode": (["Default (From Settings)", "Auto", "Filename Only", "Full Path"], {"default": "Default (From Settings)"}),
                "lora_manager_mode": (["Default (From Settings)", "Enabled", "Disabled"], {"default": "Default (From Settings)"}),
            },
            "optional": {
                "passthrough": ("*", {})
            }
        }

    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("passthrough",)
    FUNCTION = "execute"
    CATEGORY = "Autocomplete++"
    OUTPUT_NODE = True

    def execute(self, enable_lora_embedding="Default (From Settings)", lora_path_mode="Default (From Settings)",
                lora_manager_mode="Default (From Settings)", passthrough=None):
        return (passthrough,)


class AutocompletePlusDictionariesController:
    """
    Canvas controller node for dynamic dictionary and translation selection.
    Overrides global dictionary settings for all prompt nodes.
    """
    @classmethod
    def INPUT_TYPES(cls):
        tag_files, trans_files = get_available_tag_files()
        tag_options = ["Default (From Settings)"] + [f["filename"] for f in tag_files]
        trans_options = ["Default (From Settings)", "None"] + [f["filename"] for f in trans_files]
        return {
            "required": {
                "tag_file": (tag_options, {"default": "Default (From Settings)"}),
                "extra_tag_files_mode": (["Default (From Settings)", "Override (Use Custom List)", "None (Disable Extra Files)"], {"default": "Default (From Settings)"}),
                "extra_tag_files": ("STRING", {"default": "", "multiline": True, "placeholder": "Click or type to pick available CSV dictionaries..."}),
                "translation_file": (trans_options, {"default": "Default (From Settings)"}),
            },
            "optional": {
                "passthrough": ("*", {})
            }
        }

    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("passthrough",)
    FUNCTION = "execute"
    CATEGORY = "Autocomplete++"
    OUTPUT_NODE = True

    def execute(self, tag_file="Default (From Settings)", extra_tag_files_mode="Default (From Settings)", extra_tag_files="", translation_file="Default (From Settings)", passthrough=None):
        return (passthrough,)


NODE_CLASS_MAPPINGS = {
    "AutocompletePlusController": AutocompletePlusController,
    "AutocompletePlusFormattingController": AutocompletePlusFormattingController,
    "AutocompletePlusIntegrationsController": AutocompletePlusIntegrationsController,
    "AutocompletePlusDictionariesController": AutocompletePlusDictionariesController
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AutocompletePlusController": "Autocomplete++ Wildcard & Dynamic Controller",
    "AutocompletePlusFormattingController": "Autocomplete++ Formatting Controller",
    "AutocompletePlusIntegrationsController": "Autocomplete++ Integrations Controller",
    "AutocompletePlusDictionariesController": "Autocomplete++ Dictionaries Controller"
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]


