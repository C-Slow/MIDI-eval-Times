import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
import homeassistant.helpers.config_validation as cv

from .const import DOMAIN

class MidievalTimesConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for MIDI-eval Times."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Handle the initial step."""
        errors = {}
        if user_input is not None:
            # We could add validation here to check if the host is reachable
            return self.async_create_entry(title="Piano", data=user_input)

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({
                vol.Required("host", default="http://localhost:8000"): str,
            }),
            errors=errors,
        )
