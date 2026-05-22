import logging
import requests
from homeassistant.components.media_player import (
    MediaPlayerEntity,
    MediaPlayerEntityFeature,
    MediaPlayerDeviceClass,
)
from homeassistant.const import STATE_IDLE, STATE_PLAYING, STATE_OFF
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the MIDI-eval Times media player."""
    host = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([MidievalPiano(host, entry.title)], True)

class MidievalPiano(MediaPlayerEntity):
    """Representation of the MIDI-eval Times Piano."""

    _attr_device_class = MediaPlayerDeviceClass.RECEIVER
    _attr_supported_features = (
        MediaPlayerEntityFeature.PLAY
        | MediaPlayerEntityFeature.STOP
        | MediaPlayerEntityFeature.NEXT_TRACK
        | MediaPlayerEntityFeature.SELECT_SOURCE
        | MediaPlayerEntityFeature.SEEK
    )

    def __init__(self, host, name):
        """Initialize the piano."""
        self._host = host
        self._attr_name = name
        self._attr_unique_id = f"{DOMAIN}_{host}"
        self._state = STATE_OFF
        self._status = {}

    @property
    def state(self):
        """Return the state of the device."""
        if not self._status:
            return STATE_OFF
        return STATE_PLAYING if self._status.get("playing") else STATE_IDLE

    @property
    def media_title(self):
        """Title of current playing media."""
        return self._status.get("file")

    @property
    def media_duration(self):
        """Duration of current playing media in seconds."""
        return self._status.get("length")

    @property
    def media_position(self):
        """Position of current playing media in seconds."""
        return self._status.get("elapsed")

    @property
    def media_position_updated_at(self):
        """When was the position last updated."""
        import homeassistant.util.dt as dt_util
        return dt_util.utcnow()

    @property
    def source_list(self):
        """List of available input sources (playlists)."""
        try:
            response = requests.get(f"{self._host}/playlists", timeout=5)
            if response.status_code == 200:
                return list(response.json().keys())
        except Exception as e:
            _LOGGER.error("Error fetching playlists: %s", e)
        return []

    def select_source(self, source):
        """Select input source (play a playlist)."""
        try:
            requests.post(f"{self._host}/playlists/play?name={source}", timeout=5)
        except Exception as e:
            _LOGGER.error("Error playing playlist %s: %s", source, e)

    def media_play(self):
        """Send play command."""
        # By default, we might just try to resume or play the first playlist
        sources = self.source_list
        if sources:
            self.select_source(sources[0])

    def media_stop(self):
        """Send stop command."""
        try:
            requests.post(f"{self._host}/play/stop", timeout=5)
            requests.post(f"{self._host}/queue/stop", timeout=5)
        except Exception as e:
            _LOGGER.error("Error stopping playback: %s", e)

    def media_next_track(self):
        """Send next track command."""
        try:
            requests.post(f"{self._host}/queue/next", timeout=5)
        except Exception as e:
            _LOGGER.error("Error skipping track: %s", e)

    def media_seek(self, position):
        """Send seek command."""
        try:
            # We use /queue/seek if in a playlist, or /play/seek for ad-hoc
            # For simplicity, we'll try queue seek first
            requests.post(f"{self._host}/queue/seek", json={"offset": position}, timeout=5)
        except Exception as e:
            _LOGGER.error("Error seeking: %s", e)

    def update(self):
        """Retrieve latest state."""
        try:
            # Try to get queue status first
            response = requests.get(f"{self._host}/queue/status", timeout=5)
            if response.status_code == 200:
                self._status = response.json()
            else:
                # Fallback to ad-hoc playback status
                response = requests.get(f"{self._host}/playback/status", timeout=5)
                if response.status_code == 200:
                    self._status = response.json()
        except Exception as e:
            _LOGGER.error("Error updating piano state: %s", e)
            self._status = {}
