import dataclasses

# Python 3.11+ dataclasses mutable default values compatibility patch for fairseq
_orig_get_field = dataclasses._get_field

def _patched_get_field(cls, a_name, a_type, default_kw_only):
    try:
        return _orig_get_field(cls, a_name, a_type, default_kw_only)
    except ValueError as e:
        if "mutable default" in str(e) and "use default_factory" in str(e):
            # Capture the default value of the field from the class attribute
            val = getattr(cls, a_name)
            
            # Re-wrap in a dataclass field with a default_factory to bypass Python 3.11+ strictness
            def make_factory(v):
                return lambda: v
            
            new_field = dataclasses.field(default_factory=make_factory(val))
            setattr(cls, a_name, new_field)
            
            # Re-run original _get_field, which will now use the generated Field object
            return _orig_get_field(cls, a_name, a_type, default_kw_only)
        raise e

dataclasses._get_field = _patched_get_field
