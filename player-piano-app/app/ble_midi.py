import asyncio
import threading
import time
from bleak import BleakClient, BleakScanner

# MIDI service UUID for BLE MIDI
MIDI_SERVICE_UUID = "03b80e5a-ede8-4b33-a751-6ce34ec4c700"
MIDI_CHARACTERISTIC_UUID = "7772e5db-3868-4112-a1a9-f2669d106bf3"

class BleMidiOutput:
    def __init__(self, target_name="Yamaha"):
        self.target_name = target_name
        self.client = None
        self.loop = None
        self.thread = None
        self.queue = asyncio.Queue()
        self.connected = False
        self.name = f"BLE:{target_name}"
        self._stop_requested = False

    def open(self):
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        # Wait for connection (briefly)
        for _ in range(20):
            if self.connected: break
            time.sleep(0.5)
        return self.connected

    def _run_loop(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.loop.run_until_complete(self._main_task())

    async def _main_task(self):
        while not self._stop_requested:
            if not self.connected:
                print(f"BLE: Searching for {self.target_name}...")
                device = await BleakScanner.find_device_by_filter(
                    lambda d, ad: d.name and self.target_name.lower() in d.name.lower()
                )
                if device:
                    print(f"BLE: Found {device.name}, connecting...")
                    try:
                        async with BleakClient(device) as client:
                            self.client = client
                            self.connected = True
                            print(f"BLE: Connected to {device.name}")
                            
                            # Start processing queue
                            while self.connected and not self._stop_requested:
                                try:
                                    # Use a timeout so we can check connected status
                                    msg = await asyncio.wait_for(self.queue.get(), timeout=1.0)
                                    # Wrap MIDI bytes in BLE MIDI packet
                                    # [Header, TimestampLow, ...MIDI...]
                                    packet = bytes([0x80, 0x80]) + bytes(msg)
                                    await client.write_gatt_char(MIDI_CHARACTERISTIC_UUID, packet, response=False)
                                    self.queue.task_done()
                                except asyncio.TimeoutError:
                                    if not client.is_connected:
                                        self.connected = False
                                except Exception as e:
                                    print(f"BLE: Send error: {e}")
                                    self.connected = False
                    except Exception as e:
                        print(f"BLE: Connection error: {e}")
                        self.connected = False
                else:
                    await asyncio.sleep(5)
            else:
                await asyncio.sleep(1)

    def send(self, msg):
        """Standard mido-like send method."""
        if not self.connected or not self.loop: return
        self.loop.call_soon_threadsafe(self.queue.put_nowait, msg.bytes())

    def close(self):
        self._stop_requested = True
        self.connected = False
        if self.loop:
            self.loop.stop()

    def is_connected(self):
        return self.connected
