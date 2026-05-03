import mido
import json
import os
from google import genai
from google.genai import types
from pathlib import Path

def extract_midi_info(file_path: str) -> dict:
    """Extract metadata and track statistics from a MIDI file."""
    try:
        mid = mido.MidiFile(file_path)
        info = {
            "filename": os.path.basename(file_path),
            "track_names": [],
            "text_events": [],
            "stats": {
                "total_notes": 0,
                "avg_velocity": 0,
                "tracks": []
            }
        }
        
        total_vel = 0
        note_count = 0
        
        for i, track in enumerate(mid.tracks):
            t_name = ""
            t_notes = 0
            t_vel = 0
            
            for msg in track:
                if msg.type == 'track_name':
                    t_name = getattr(msg, 'name', '').strip()
                    if t_name and t_name not in info["track_names"]:
                        info["track_names"].append(t_name)
                elif msg.type in ['text', 'copyright', 'comment']:
                    text = getattr(msg, 'text', '').strip()
                    if text and text not in info["text_events"]:
                        info["text_events"].append(text)
                elif msg.type == 'note_on' and msg.velocity > 0:
                    t_notes += 1
                    t_vel += msg.velocity
            
            if t_notes > 0:
                info["stats"]["tracks"].append({
                    "index": i,
                    "name": t_name,
                    "note_count": t_notes,
                    "avg_velocity": round(t_vel / t_notes, 1)
                })
                total_vel += t_vel
                note_count += t_notes
        
        info["stats"]["total_notes"] = note_count
        if note_count > 0:
            info["stats"]["avg_velocity"] = round(total_vel / note_count, 1)
                    
        return info
    except Exception as e:
        print(f"Error extracting MIDI info: {e}")
        return {}

class GeminiService:
    def __init__(self, api_key: str):
        if not api_key:
            self.client = None
            return
        # Use default settings (v1beta) which is usually most compatible for AI Studio keys
        self.client = genai.Client(api_key=api_key)

    async def analyze_midi(self, midi_info: dict) -> dict:
        """Use Gemini to analyze MIDI info and suggest metadata/cleaning settings."""
        if not self.client:
            return {}

        prompt = f"""
        Analyze this MIDI file information and provide structured metadata.
        MIDI Info: {json.dumps(midi_info)}

        Respond ONLY with a JSON object containing:
        - "clean_title": A polished version of the song title (e.g., remove messy suffixes like "-midi", "-v1", etc).
        - "artist": The likely artist or composer.
        - "genre": Likely genre.
        - "mood": Likely mood.
        - "suggested_clean": An object with:
            - "profile": Suggested pedal intensity profile ("light", "medium", "full").
            - "rhythm_factor": Suggested rhythm velocity factor (0.2 to 2.0).
            - "melody_factor": Suggested melody velocity factor (0.2 to 2.0).
        - "is_game_or_movie": Boolean.
        - "source": If game/movie, the title of the game/movie (otherwise null).

        Context for "suggested_clean":
        - BASELINE: Start everything at 0.75 (75%) for both factors.
        - If "avg_velocity" is high (e.g. > 80), consider reducing both factors further (e.g. 0.65).
        - If there is a very obvious repetitive rhythm (often high note count in tracks named "drums", "bass", or "accompaniment"), reduce "rhythm_factor" more than melody (e.g. rhythm 0.5, melody 0.75).
        - expressive piano pieces (Chopin, Debussy) should use "full" pedal profile and can stay closer to 0.85 for melody to keep dynamics.
        - If it's a very fast/busy song, use "light" pedal profile. Most pop uses "medium" or "full" depending on energy.

        Example JSON output:
        {{
          "clean_title": "Moonlight Sonata - 1st Movement",
          "artist": "Ludwig van Beethoven",
          "genre": "Classical",
          "mood": "Melancholy",
          "suggested_clean": {{
            "profile": "full",
            "rhythm_factor": 1.0,
            "melody_factor": 1.1
          }},
          "is_game_or_movie": false,
          "source": null
        }}
        """

        models_to_try = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash-lite']
        
        last_error = None
        for model_name in models_to_try:
            try:
                response = self.client.models.generate_content(
                    model=model_name,
                    contents=prompt
                )
                
                text = response.text
                if "```json" in text:
                    text = text.split("```json")[1].split("```")[0]
                elif "```" in text:
                    text = text.split("```")[1].split("```")[0]
                
                return json.loads(text.strip())
            except Exception as e:
                last_error = e
                print(f"Model {model_name} failed: {str(e)}")
                continue

        if last_error:
            if "404" in str(last_error):
                print("Gemini Model Not Found (404). Attempting to list available models for your API key...")
                try:
                    models = self.client.models.list()
                    for m in models:
                        name = getattr(m, 'name', getattr(m, 'model_name', str(m)))
                        print(f" - {name}")
                except Exception as list_err:
                    print(f"Could not list models: {list_err}")
            
            print(f"Gemini Analysis Error after trying all models: {str(last_error)}")
        
        return {}

    async def analyze_audio_command(self, audio_path: str, context: dict) -> dict:
        """Analyze a voice command from an audio file and map it to an action."""
        if not self.client:
            return {}

        try:
            with open(audio_path, "rb") as f:
                audio_bytes = f.read()
            
            prompt_text = f"""
            Listen to this voice command and decide the best action for the Player Piano app.
            
            Library Context:
            - Playlists: {json.dumps(context.get('playlists', []))}
            - Known Artists: {json.dumps(context.get('artists', []))}
            - Known Genres: {json.dumps(context.get('genres', []))}
            - Known Moods: {json.dumps(context.get('moods', []))}
            
            Respond ONLY with a JSON object containing:
            - "action": One of ["play_playlist", "play_smart", "stop", "next", "unknown"]
            - "name": The playlist name (if action is play_playlist)
            - "filter_type": The smart filter type ["artist", "genre", "mood", "source", "rating", "all"] (if action is play_smart)
            - "filter_value": The filter value (if action is play_smart). If filter_type is "rating", this must be a digit 1-5.
            - "response_text": A short, natural speech response confirming the action.
            
            STRICT RULES:
            1. If the audio is silent, contains only background noise, or is very short (e.g. just a tap sound), return action="unknown" and response_text="".
            2. If you hear someone speaking but they are NOT giving a piano command (e.g. just talking to someone else), return action="unknown" and response_text="".
            3. ONLY trigger an action if the user explicitly asks to play, stop, or skip music (e.g. "Piano play...", "Stop", "Next song").
            4. If the user just says "Piano" or "Hello" without a command, return action="unknown" and response_text="I'm listening."
            
            Mapping examples:
            - "Play something melancholic" -> play_smart, mood=melancholic.
            - "Play my 5 star songs" -> play_smart, rating=5.
            - "Play anything with 4 stars or more" -> play_smart, rating=4.
            - "Stop the music" -> stop.
            - "Skip this" -> next.
            """

            # gemini-2.5-flash and gemini-flash-latest support audio
            models_to_try = ['gemini-2.5-flash', 'gemini-flash-latest']
            
            for model_name in models_to_try:
                try:
                    # Explicitly using types.Part for multimodal SDK calls
                    parts = [
                        types.Part.from_text(text=prompt_text),
                        types.Part.from_bytes(data=audio_bytes, mime_type='audio/mp4')
                    ]

                    response = self.client.models.generate_content(
                        model=model_name,
                        contents=parts
                    )
                    
                    text = response.text
                    if "```json" in text:
                        text = text.split("```json")[1].split("```")[0]
                    elif "```" in text:
                        text = text.split("```")[1].split("```")[0]
                    
                    return json.loads(text.strip())
                except Exception as e:
                    print(f"Audio Analysis with {model_name} failed: {e}")
                    continue
            
            return {"action": "unknown", "response_text": "I'm sorry, I couldn't process that command."}
            
        except Exception as e:
            print(f"Gemini Audio Analysis Error: {e}")
            return {"action": "unknown", "response_text": "Error communicating with AI service."}
