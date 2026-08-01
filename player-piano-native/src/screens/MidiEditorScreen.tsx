import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ActivityIndicator, 
  FlatList, 
  Alert, 
  ScrollView, 
  Dimensions,
  TextInput,
  InteractionManager,
  Modal,
  Platform,
  KeyboardAvoidingView,
  Switch,
  Pressable,
  PanResponder
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';
import { useStore } from '../store/useStore';
import { midiOrchestratorApi, pianoApi, mp3Api, playlistApi } from '../services/api';
import { Colors } from '../constants/Colors';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { setAudioMode } from '../services/audioMode';
import { useNavigation } from '@react-navigation/native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PIXELS_PER_SECOND = 40; // Timeline scale
const LANE_HEIGHT = 80;

const getPlaylistColor = (name: string) => {
  const colors = ['#4CAF50', '#2196F3', '#9C27B0', '#FF9800', '#E91E63', '#00BCD4', '#009688', '#FF5722', '#673AB7', '#3F51B5'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
};

const HoldableButton = ({ onPressAction, children, style, delayMs = 350, intervalMs = 90, ...props }: any) => {
  const timerRef = useRef<any>(null);
  const intervalRef = useRef<any>(null);
  const isHoldingRef = useRef(false);
  const actionRef = useRef(onPressAction);
  actionRef.current = onPressAction;

  const stopRepeat = React.useCallback(() => {
    isHoldingRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startRepeat = React.useCallback(() => {
    if (isHoldingRef.current) return;
    isHoldingRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    actionRef.current();
    timerRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        actionRef.current();
      }, intervalMs);
    }, delayMs);
  }, [delayMs, intervalMs]);

  useEffect(() => {
    return () => stopRepeat();
  }, [stopRepeat]);

  return (
    <TouchableOpacity
      {...props}
      style={style}
      onPressIn={startRepeat}
      onPressOut={stopRepeat}
      onMouseDown={startRepeat}
      onMouseUp={stopRepeat}
      onMouseLeave={stopRepeat}
      onTouchStart={startRepeat}
      onTouchEnd={stopRepeat}
      onResponderRelease={stopRepeat}
      onResponderTerminate={stopRepeat}
    >
      {children}
    </TouchableOpacity>
  );
};

interface NoteGridProps {
  lanesData: any[];
  pianoTracks: Set<number>;
  speakerTracks: Set<number>;
  vocalMaleTracks: Set<number>;
  vocalFemaleTracks: Set<number>;
  themeColors: any;
  durationSec: number;
  timelineWidth: number;
  totalHeight: number;
  importedVocalsEnabled: boolean;
  importedVocalsDelayMs: number;
  vocalsWaveformEnvelope: number[] | null;
  importedVocalsBreaklines: any[];
  loopStartMs: number | null;
  loopEndMs: number | null;
  loopEnabled: boolean;
  laneOffsets: number[];
  laneHeights: number[];
  finetuneTimeMs: number | null;
  finetuneMode: 'breakline' | 'loopStart' | 'loopEnd' | null;
  onUpdateBreakline: (index: number, delta: number) => void;
  onDeleteBreakline: (index: number) => void;
  onDeleteLoopStart: () => void;
  onDeleteLoopEnd: () => void;
  onLongPressVocals: (locationX: number) => void;
}

const InstrumentLanesContent = React.memo(({
  lanesData,
  laneOffsets,
  laneHeights,
  themeColors,
  pianoTracks,
  speakerTracks,
  vocalMaleTracks,
  vocalFemaleTracks,
}: any) => {
  const getTrackColor = (trackIndex: number, isPiano: boolean, isSpeaker: boolean, isMale: boolean, isFemale: boolean) => {
    if (isPiano) return themeColors.accent;
    if (isSpeaker) return '#a29bfe';
    if (isMale) return '#0984e3';
    if (isFemale) return '#e84393';
    return themeColors.textMuted;
  };
  const verticalPadding = 8;
  const usableLaneHeight = LANE_HEIGHT - (verticalPadding * 2);

  return (
    <>
      {lanesData.map((lane: any, laneIdx: number) => {
        if (lane.index === -99) return null;
        const topPos = laneOffsets[laneIdx];
        const currentLaneHeight = laneHeights[laneIdx];

        const isPiano = pianoTracks.has(lane.index);
        const isSpeaker = speakerTracks.has(lane.index);
        const isMale = vocalMaleTracks.has(lane.index);
        const isFemale = vocalFemaleTracks.has(lane.index);
        const color = getTrackColor(lane.index, isPiano, isSpeaker, isMale, isFemale);

        return (
          <View 
            key={lane.index} 
            style={[
              styles.laneTimeline, 
              { 
                height: currentLaneHeight, 
                top: topPos, 
                borderBottomColor: themeColors.border 
              }
            ]}
          >
            {lane.notes.map((note: any, noteIdx: number) => {
              const noteWidth = Math.max(2, (note.end - note.start) * PIXELS_PER_SECOND);
              const noteLeft = note.start * PIXELS_PER_SECOND;
              const normalizedPitch = (note.pitch - lane.minPitch) / lane.pitchRange;
              const noteTop = verticalPadding + (usableLaneHeight * (1 - normalizedPitch));

              return (
                <View
                  key={noteIdx}
                  style={[
                    styles.note,
                    {
                      left: noteLeft,
                      width: noteWidth,
                      top: noteTop,
                      height: 4,
                      backgroundColor: color,
                    }
                  ]}
                />
              );
            })}
          </View>
        );
      })}
    </>
  );
}, (prev, next) => {
  if (prev.lanesData !== next.lanesData) return false;
  if (prev.themeColors !== next.themeColors) return false;
  if (prev.pianoTracks !== next.pianoTracks) return false;
  if (prev.speakerTracks !== next.speakerTracks) return false;
  if (prev.vocalMaleTracks !== next.vocalMaleTracks) return false;
  if (prev.vocalFemaleTracks !== next.vocalFemaleTracks) return false;
  if (prev.laneOffsets.length !== next.laneOffsets.length) return false;
  for (let i = 0; i < prev.laneOffsets.length; i++) {
    if (prev.laneOffsets[i] !== next.laneOffsets[i]) return false;
    if (prev.laneHeights[i] !== next.laneHeights[i]) return false;
  }
  return true;
});

const NoteGrid = React.memo(({
  lanesData,
  pianoTracks,
  speakerTracks,
  vocalMaleTracks,
  vocalFemaleTracks,
  themeColors,
  durationSec,
  timelineWidth,
  totalHeight,
  importedVocalsEnabled,
  importedVocalsDelayMs,
  vocalsWaveformEnvelope,
  importedVocalsBreaklines,
  loopStartMs,
  loopEndMs,
  loopEnabled,
  laneOffsets,
  laneHeights,
  finetuneTimeMs,
  finetuneMode,
  onUpdateBreakline,
  onDeleteBreakline,
  onDeleteLoopStart,
  onDeleteLoopEnd,
  onLongPressVocals,
}: NoteGridProps) => {
  const verticalPadding = 8;
  const usableLaneHeight = LANE_HEIGHT - (verticalPadding * 2);

  const sortedBreaks = useMemo(() => {
    return [...(importedVocalsBreaklines || [])].sort((a, b) => a.time_ms - b.time_ms);
  }, [importedVocalsBreaklines]);

  return (
    <View style={{ width: timelineWidth, height: totalHeight, position: 'absolute', top: 0, left: 0 }}>
      {loopStartMs !== null && (
        <View 
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: (loopStartMs / 1000) * PIXELS_PER_SECOND,
            width: loopEndMs !== null ? Math.max(2, ((loopEndMs - loopStartMs) / 1000) * PIXELS_PER_SECOND) : 2,
            backgroundColor: loopEnabled ? 'rgba(46, 204, 113, 0.08)' : 'rgba(120, 120, 120, 0.08)',
            borderLeftWidth: 2,
            borderLeftColor: loopEnabled ? '#2ecc71' : themeColors.textMuted,
            borderRightWidth: loopEndMs !== null ? 2 : 0,
            borderRightColor: loopEnabled ? '#e74c3c' : themeColors.textMuted,
            zIndex: 9
          }}
        />
      )}

      {/* Finetune Marker Line */}
      {finetuneTimeMs !== null && finetuneMode !== null && (
        <View 
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: (finetuneTimeMs / 1000) * PIXELS_PER_SECOND,
            width: 2,
            backgroundColor: '#0984e3',
            zIndex: 20
          }}
        />
      )}

      {(importedVocalsBreaklines || []).map((breakline: any, idx: number) => {
        const left = (breakline.time_ms / 1000) * PIXELS_PER_SECOND;
        return (
          <View 
            key={`breakline-line-${idx}`}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left,
              width: 1,
              borderStyle: 'dashed',
              borderWidth: 1.5,
              borderColor: '#e84393',
              zIndex: 10
            }}
          />
        );
      })}

      {Array.from({ length: Math.ceil(durationSec / 5) }).map((_, i) => (
        <View 
          key={`grid-${i}`} 
          style={[
            styles.gridLine, 
            { 
              left: i * 5 * PIXELS_PER_SECOND, 
              borderColor: themeColors.border, 
              height: totalHeight 
            }
          ]} 
        />
      ))}

      {lanesData.map((lane: any, laneIdx: number) => {
        if (lane.index !== -99) return null;
        const topPos = laneOffsets[laneIdx];
        const currentLaneHeight = laneHeights[laneIdx];
        const waveformColor = importedVocalsEnabled ? '#e84393' : 'rgba(120, 120, 120, 0.4)';

        return (
          <View 
            key={lane.index} 
            style={[
              styles.laneTimeline, 
              { 
                height: currentLaneHeight, 
                top: topPos, 
                borderBottomColor: themeColors.border,
                backgroundColor: 'rgba(232, 67, 147, 0.05)'
              }
            ]}
          >
            {/* Pressable vocal lane area for long-press */}
            <Pressable
              onLongPress={(evt) => {
                onLongPressVocals(evt.nativeEvent.locationX);
              }}
              style={{ position: 'absolute', top: 0, left: 0, width: timelineWidth, height: 70 }}
            >
              <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                {vocalsWaveformEnvelope && vocalsWaveformEnvelope.length > 0 ? (
                  vocalsWaveformEnvelope.map((val: number, idx: number) => {
                    const tMs = idx * 100; // 10 points per sec = 100ms per point
                    
                    // Compute dynamic segment offset based on audio boundaries
                    let offsetMs = importedVocalsDelayMs;
                    if (sortedBreaks.length > 0) {
                      for (const b of sortedBreaks) {
                        const audioBoundary = b.time_ms - offsetMs;
                        if (tMs > audioBoundary) {
                          offsetMs = b.offset_ms;
                        } else {
                          break;
                        }
                      }
                    }
                    
                    const delayOffsetPx = (offsetMs / 1000) * PIXELS_PER_SECOND;
                    const left = idx * 0.1 * PIXELS_PER_SECOND + delayOffsetPx;
                    if (left < -10 || left > timelineWidth + 10) return null;
                    
                    // Center waveform in top 70px envelope region
                    const barHeight = Math.max(2, val * (70 - verticalPadding * 2));
                    const barTop = verticalPadding + ((70 - verticalPadding * 2) - barHeight) / 2;
                    
                    return (
                      <View
                        key={idx}
                        style={{
                          position: 'absolute',
                          left,
                          width: Math.max(1, 0.1 * PIXELS_PER_SECOND - 1),
                          top: barTop,
                          height: barHeight,
                          backgroundColor: waveformColor,
                          borderRadius: 1
                        }}
                      />
                    );
                  })
                ) : (
                  <Text style={{ position: 'absolute', left: 20, top: 25, fontSize: 11, color: themeColors.textMuted, fontStyle: 'italic' }}>
                    No waveform data loaded. Long-press here to place markers.
                  </Text>
                )}
              </View>
            </Pressable>

            {/* Inline Breakline Alignment Controllers in the bottom 50px of expanded lane */}
            {sortedBreaks.map((b, index) => {
              const left = (b.time_ms / 1000) * PIXELS_PER_SECOND;
              
              return (
                <View
                  key={`inline-ctrl-${index}`}
                  style={{
                    position: 'absolute',
                    left: left - 65, // Center the 130px wide controller row
                    width: 130,
                    top: 72,
                    height: 44,
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(30, 30, 30, 0.9)',
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: '#e84393',
                    zIndex: 100,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.25,
                    shadowRadius: 3.84,
                    elevation: 5,
                  }}
                >
                  <Text style={{ fontSize: 9, color: '#fff', fontWeight: 'bold', marginBottom: 2 }}>
                    {b.offset_ms >= 0 ? `+${b.offset_ms}` : b.offset_ms} ms
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    {/* Decrements */}
                    {[-50, -10].map(val => (
                      <HoldableButton
                        key={`bctrl-${val}`}
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.15)',
                          paddingHorizontal: 4,
                          paddingVertical: 2,
                          borderRadius: 3
                        }}
                        onPressAction={() => onUpdateBreakline(index, val)}
                      >
                        <Text style={{ color: '#fff', fontSize: 8 }}>{val}</Text>
                      </HoldableButton>
                    ))}

                    {/* Delete Breakline button */}
                    <TouchableOpacity
                      style={{
                        backgroundColor: '#e74c3c',
                        paddingHorizontal: 5,
                        paddingVertical: 2,
                        borderRadius: 3
                      }}
                      onPress={() => onDeleteBreakline(index)}
                    >
                      <Ionicons name="close" size={10} color="#fff" />
                    </TouchableOpacity>

                    {/* Increments */}
                    {[10, 50].map(val => (
                      <HoldableButton
                        key={`bctrl-${val}`}
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.15)',
                          paddingHorizontal: 4,
                          paddingVertical: 2,
                          borderRadius: 3
                        }}
                        onPressAction={() => onUpdateBreakline(index, val)}
                      >
                        <Text style={{ color: '#fff', fontSize: 8 }}>{`+${val}`}</Text>
                      </HoldableButton>
                    ))}
                  </View>
                </View>
              );
            })}
          </View>
        );
      })}

      <InstrumentLanesContent
        lanesData={lanesData}
        laneOffsets={laneOffsets}
        laneHeights={laneHeights}
        themeColors={themeColors}
        pianoTracks={pianoTracks}
        speakerTracks={speakerTracks}
        vocalMaleTracks={vocalMaleTracks}
        vocalFemaleTracks={vocalFemaleTracks}
      />
    </View>
  );
}, (prevProps, nextProps) => {
  if (prevProps.timelineWidth !== nextProps.timelineWidth) return false;
  if (prevProps.totalHeight !== nextProps.totalHeight) return false;
  if (prevProps.durationSec !== nextProps.durationSec) return false;
  if (prevProps.themeColors !== nextProps.themeColors) return false;
  if (prevProps.lanesData !== nextProps.lanesData) return false;
  if (prevProps.importedVocalsEnabled !== nextProps.importedVocalsEnabled) return false;
  if (prevProps.importedVocalsDelayMs !== nextProps.importedVocalsDelayMs) return false;
  if (prevProps.vocalsWaveformEnvelope !== nextProps.vocalsWaveformEnvelope) return false;
  if (prevProps.importedVocalsBreaklines !== nextProps.importedVocalsBreaklines) return false;
  if (prevProps.loopStartMs !== nextProps.loopStartMs) return false;
  if (prevProps.loopEndMs !== nextProps.loopEndMs) return false;
  if (prevProps.loopEnabled !== nextProps.loopEnabled) return false;
  if (prevProps.finetuneTimeMs !== nextProps.finetuneTimeMs) return false;
  if (prevProps.finetuneMode !== nextProps.finetuneMode) return false;
  
  if (prevProps.laneOffsets.length !== nextProps.laneOffsets.length) return false;
  if (prevProps.laneHeights.length !== nextProps.laneHeights.length) return false;
  for (let i = 0; i < prevProps.laneOffsets.length; i++) {
    if (prevProps.laneOffsets[i] !== nextProps.laneOffsets[i]) return false;
    if (prevProps.laneHeights[i] !== nextProps.laneHeights[i]) return false;
  }

  if (prevProps.pianoTracks.size !== nextProps.pianoTracks.size) return false;
  if (prevProps.speakerTracks.size !== nextProps.speakerTracks.size) return false;
  if (prevProps.vocalMaleTracks.size !== nextProps.vocalMaleTracks.size) return false;
  if (prevProps.vocalFemaleTracks.size !== nextProps.vocalFemaleTracks.size) return false;
  
  for (const item of prevProps.pianoTracks) {
    if (!nextProps.pianoTracks.has(item)) return false;
  }
  for (const item of prevProps.speakerTracks) {
    if (!nextProps.speakerTracks.has(item)) return false;
  }
  for (const item of prevProps.vocalMaleTracks) {
    if (!nextProps.vocalMaleTracks.has(item)) return false;
  }
  for (const item of prevProps.vocalFemaleTracks) {
    if (!nextProps.vocalFemaleTracks.has(item)) return false;
  }
  
  return true;
});

export const MidiEditorScreen = () => {
  const theme = useStore(state => state.theme);
  const themeColors = Colors[theme];
  const navigation = useNavigation();
  const isPianoConnected = useStore(state => state.isPianoConnected);
  const globalOffset = useStore(state => state.midiOrchestrateOffset);
  const setGlobalOffset = useStore(state => state.setMidiOrchestrateOffset);
  const setSystemBusy = useStore(state => state.setSystemBusy);

  // Screen Stages: 'list' | 'visualizer'
  const [stage, setStage] = useState<'list' | 'visualizer'>('list');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<any[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  
  // Track configuration state
  const [pianoTracks, setPianoTracks] = useState<Set<number>>(new Set());
  const [speakerTracks, setSpeakerTracks] = useState<Set<number>>(new Set());
  const [vocalMaleTracks, setVocalMaleTracks] = useState<Set<number>>(new Set());
  const [vocalFemaleTracks, setVocalFemaleTracks] = useState<Set<number>>(new Set());
  const [pedalPreset, setPedalPreset] = useState<'light' | 'medium' | 'full'>('light');
  const [rhythmFactor, setRhythmFactor] = useState(1.0);
  const [melodyFactor, setMelodyFactor] = useState(1.0);

  // Imported MP3 Vocals State
  const [importedVocalsJobId, setImportedVocalsJobId] = useState<string | null>(null);
  const [importedVocalsOriginalName, setImportedVocalsOriginalName] = useState<string | null>(null);
  const [importedVocalsDelayMs, setImportedVocalsDelayMs] = useState<number>(0);
  const [importedVocalsEnabled, setImportedVocalsEnabled] = useState<boolean>(true);
  const [importedVocalsVolumeFactor, setImportedVocalsVolumeFactor] = useState<number>(1.0);
  const [importedVocalsBreaklines, setImportedVocalsBreaklines] = useState<any[]>([]);

  // Looping Playback State
  const [loopStartMs, setLoopStartMs] = useState<number | null>(null);
  const [loopEndMs, setLoopEndMs] = useState<number | null>(null);
  const [loopEnabled, setLoopEnabled] = useState<boolean>(false);
  const [vocalsWaveformEnvelope, setVocalsWaveformEnvelope] = useState<number[] | null>(null);
  const [mp3Jobs, setMp3Jobs] = useState<any[]>([]);
  const [showMp3ImportModal, setShowMp3ImportModal] = useState(false);

  // Drag reordering state for MP3 Vocals track
  const [mp3VocalsPosition, setMp3VocalsPosition] = useState<number | null>(null);
  const [isDraggingMp3Vocals, setIsDraggingMp3Vocals] = useState<boolean>(false);

  const dragStartYRef = useRef<number>(0);
  const mp3StartPosRef = useRef<number>(0);
  const longPressTimerRef = useRef<any>(null);

  const loopConfigRef = useRef({ enabled: false, start: null as number | null, end: null as number | null });
  useEffect(() => {
    loopConfigRef.current = { enabled: loopEnabled, start: loopStartMs, end: loopEndMs };
  }, [loopEnabled, loopStartMs, loopEndMs]);

  // Keep Awake during active playing
  const wasPlayingRef = useRef(false);
  useEffect(() => {
    const currentlyPlaying = isPlaying || isPreviewPlaying;
    if (currentlyPlaying !== wasPlayingRef.current) {
      wasPlayingRef.current = currentlyPlaying;
      if (currentlyPlaying) {
        activateKeepAwakeAsync().catch(err => console.error('Failed to activate keep awake', err));
      } else {
        deactivateKeepAwake().catch(err => console.error('Failed to deactivate keep awake', err));
      }
    }
    return () => {
      if (wasPlayingRef.current) {
        deactivateKeepAwake().catch(() => {});
      }
    };
  }, [isPlaying, isPreviewPlaying]);

  // Tooltip & Finetuning States
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipTimeMs, setTooltipTimeMs] = useState(0);
  const [finetuneMode, setFinetuneMode] = useState<'breakline' | 'loopStart' | 'loopEnd' | null>(null);
  const [finetuneTimeMs, setFinetuneTimeMs] = useState(0);

  // Settings Panel visibility
  const [showSettings, setShowSettings] = useState(false);

  // Backend Audio / Speaker states
  const backendAudioEnabled = useStore(state => state.backendAudioEnabled);
  const setBackendAudioEnabled = useStore(state => state.setBackendAudioEnabled);
  const backendAudioVolume = useStore(state => state.backendAudioVolume);
  const setBackendAudioVolume = useStore(state => state.setBackendAudioVolume);
  const selectedDevice = useStore(state => state.selectedDevice);
  const setSelectedDevice = useStore(state => state.setSelectedDevice);
  const [audioDevices, setAudioDevices] = useState<any[]>([]);

  // SoundFont & DSP Audio Quality states
  const [soundfonts, setSoundfonts] = useState<string[]>([]);
  const [activeSoundfont, setActiveSoundfont] = useState<string>('SGM-V2.01.sf2');
  const [reverbEnabled, setReverbEnabled] = useState<boolean>(true);
  const [reverbRoomSize, setReverbRoomSize] = useState<number>(0.75);

  const pianoPlayback = useStore(state => state.pianoPlayback);
  const pianoStartedRef = useRef(false);

  useEffect(() => {
    if (pianoPlayback.isPlaying) {
      pianoStartedRef.current = true;
    }
  }, [pianoPlayback.isPlaying]);

  // If the piano stops playing, stop our local editor playback
  useEffect(() => {
    if (isPlaying) {
      if (!pianoPlayback.isPlaying && pianoStartedRef.current) {
        console.log('MIDI Editor: Detected piano stopped playing, stopping local playback...');
        stopPlayback();
      }
    } else {
      pianoStartedRef.current = false;
    }
  }, [pianoPlayback.isPlaying, isPlaying]);

  // Load backend audio settings on mount
  useEffect(() => {
    const initSettings = async () => {
      try {
        const data = await midiOrchestratorApi.getAudioSettings();
        setBackendAudioEnabled(data.backend_audio_enabled);
        setSelectedDevice(data.selected_device);
        setBackendAudioVolume(data.backend_audio_volume ?? 1.0);
        if (data.active_soundfont) setActiveSoundfont(data.active_soundfont);
        if (data.reverb_enabled !== undefined) setReverbEnabled(data.reverb_enabled);
        if (data.reverb_room_size !== undefined) setReverbRoomSize(data.reverb_room_size);
      } catch (err) {
        console.error('Failed to fetch backend audio settings', err);
      }
    };
    initSettings();
  }, [setBackendAudioEnabled, setBackendAudioVolume]);

  // Fetch devices and soundfonts when settings panel is opened
  useEffect(() => {
    if (showSettings) {
      const fetchDevicesAndSoundfonts = async () => {
        try {
          const [devicesRes, sfRes] = await Promise.all([
            midiOrchestratorApi.getAudioDevices(),
            midiOrchestratorApi.getSoundfonts()
          ]);
          setAudioDevices(devicesRes.devices || []);
          if (sfRes.soundfonts) setSoundfonts(sfRes.soundfonts);
          if (sfRes.active_soundfont) setActiveSoundfont(sfRes.active_soundfont);
        } catch (err) {
          console.error('Failed to fetch audio devices or soundfonts', err);
        }
      };
      fetchDevicesAndSoundfonts();
    }
  }, [showSettings]);

  const handleSelectSoundfont = async (sf: string) => {
    setActiveSoundfont(sf);
    try {
      await midiOrchestratorApi.saveAudioSettings(backendAudioEnabled, selectedDevice, backendAudioVolume, {
        active_soundfont: sf,
        reverb_enabled: reverbEnabled,
        reverb_room_size: reverbRoomSize
      });
    } catch (err) {
      console.error('Failed to save soundfont setting', err);
    }
  };

  const handleToggleReverb = async (enabled: boolean) => {
    setReverbEnabled(enabled);
    try {
      await midiOrchestratorApi.saveAudioSettings(backendAudioEnabled, selectedDevice, backendAudioVolume, {
        active_soundfont: activeSoundfont,
        reverb_enabled: enabled,
        reverb_room_size: reverbRoomSize
      });
    } catch (err) {
      console.error('Failed to save reverb setting', err);
    }
  };

  const handleChangeReverbRoomSize = async (size: number) => {
    setReverbRoomSize(size);
    try {
      await midiOrchestratorApi.saveAudioSettings(backendAudioEnabled, selectedDevice, backendAudioVolume, {
        active_soundfont: activeSoundfont,
        reverb_enabled: reverbEnabled,
        reverb_room_size: size
      });
    } catch (err) {
      console.error('Failed to save reverb room size setting', err);
    }
  };

  const handleToggleBackendAudio = async (enabled: boolean) => {
    setBackendAudioEnabled(enabled);
    try {
      if (enabled) {
        await midiOrchestratorApi.saveAudioSettings(true, selectedDevice, backendAudioVolume);
        if (selectedDevice) {
          await midiOrchestratorApi.connectBluetoothDevice(selectedDevice);
        }
      } else {
        await midiOrchestratorApi.saveAudioSettings(false, selectedDevice, backendAudioVolume);
        await midiOrchestratorApi.disconnectBluetoothDevice();
      }
    } catch (err: any) {
      console.error('Error toggling backend audio', err);
      Alert.alert('Settings Error', `Failed to apply backend audio settings: ${err.message}`);
    }
  };

  const handleSelectDevice = async (device: string) => {
    setSelectedDevice(device);
    try {
      await midiOrchestratorApi.saveAudioSettings(backendAudioEnabled, device, backendAudioVolume);
      if (backendAudioEnabled && device) {
        await midiOrchestratorApi.connectBluetoothDevice(device);
      }
    } catch (err: any) {
      console.error('Error selecting device', err);
      Alert.alert('Connection Error', `Failed to connect device: ${err.message}`);
    }
  };

  const handleVolumeChange = async (vol: number) => {
    setBackendAudioVolume(vol);
    try {
      await midiOrchestratorApi.setVolume(vol);
    } catch (err) {
      console.error('Failed to set volume', err);
    }
  };

  // Playback / Visualizer State
  const [notes, setNotes] = useState<Record<string, any[]>>({});
  const [playbackPos, setPlaybackPos] = useState(0); // in ms
  const [playbackDuration, setPlaybackDuration] = useState(0); // in ms
  const soundRef = useRef<Audio.Sound | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const playbackTimerRef = useRef<any>(null);
  const isSeekingRef = useRef(false);

  // Preview State
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Context Actions Bottom Sheet & Modals State
  const [contextJob, setContextJob] = useState<any | null>(null);
  const [recleanVisible, setRecleanVisible] = useState(false);
  const [recleanRhythm, setRecleanRhythm] = useState(1.0);
  const [recleanMelody, setRecleanMelody] = useState(1.0);
  const [recleanPedal, setRecleanPedal] = useState<'light' | 'medium' | 'full'>('light');

  const [detailsVisible, setDetailsVisible] = useState(false);
  const [detailsTitle, setDetailsTitle] = useState('');
  const [detailsArtist, setDetailsArtist] = useState('');
  const [detailsComments, setDetailsComments] = useState('');
  const [detailsRating, setDetailsRating] = useState(0);
  const [detailsGenre, setDetailsGenre] = useState('');
  const [detailsMood, setDetailsMood] = useState('');
  const [detailsSource, setDetailsSource] = useState('');
  const [detailsDnu, setDetailsDnu] = useState(false);
  const [detailsValidated, setDetailsValidated] = useState(false);
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [playbackMode, setPlaybackMode] = useState<'preview' | 'performance'>('preview');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'artist' | 'rating' | 'created' | 'length'>('created');
  const previewSoundRef = useRef<Audio.Sound | null>(null);

  const toggleSelect = (jobId: string) => {
    setSelectedJobs(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const clearSelection = () => setSelectedJobs(new Set());

  const getCleanTitle = (filename: string) => {
    if (!filename) return '';
    return filename.replace(/\.midi?$/i, '');
  };

  const getSongLength = (item: any) => {
    if (!item.tracks || item.tracks.length === 0) return '';
    const maxDuration = Math.max(...item.tracks.map((t: any) => t.duration || 0));
    if (maxDuration <= 0) return '';
    const mins = Math.floor(maxDuration / 60);
    const secs = Math.floor(maxDuration % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const renderStars = (count: number) => {
    if (!count || count <= 0) return null;
    return (
      <View style={{ flexDirection: 'row', marginLeft: 6 }}>
        {[1, 2, 3, 4, 5].map(i => (
          <Ionicons 
            key={i} 
            name={i <= count ? "star" : "star-outline"} 
            size={10} 
            color={i <= count ? "#FFD700" : themeColors.textMuted} 
          />
        ))}
      </View>
    );
  };

  // Selected job details
  const currentJob = useMemo(() => {
    return jobs.find(j => j.job_id === selectedJobId) || null;
  }, [jobs, selectedJobId]);

  const filteredJobs = useMemo(() => {
    let result = [...jobs];
    
    // 1. Search Filter (treat dashes and underscores as spaces)
    if (search.trim()) {
      const query = search.toLowerCase().replace(/[-_]/g, ' ');
      result = result.filter(j => {
        const title = (j.filename || '').toLowerCase().replace(/[-_]/g, ' ');
        const artist = (j.artist || '').toLowerCase().replace(/[-_]/g, ' ');
        return title.includes(query) || artist.includes(query);
      });
    }

    // 2. Sorting
    result.sort((a, b) => {
      if (sortBy === 'name') {
        const aTitle = getCleanTitle(a.filename || '');
        const bTitle = getCleanTitle(b.filename || '');
        return aTitle.localeCompare(bTitle);
      } else if (sortBy === 'artist') {
        return (a.artist || '').localeCompare(b.artist || '');
      } else if (sortBy === 'rating') {
        return (b.rating || 0) - (a.rating || 0);
      } else if (sortBy === 'created') {
        return (b.timestamp || 0) - (a.timestamp || 0);
      } else if (sortBy === 'length') {
        const aLen = a.tracks && a.tracks.length > 0 ? Math.max(...a.tracks.map((t: any) => t.duration || 0)) : 0;
        const bLen = b.tracks && b.tracks.length > 0 ? Math.max(...b.tracks.map((t: any) => t.duration || 0)) : 0;
        return bLen - aLen;
      }
      return 0;
    });

    return result;
  }, [jobs, search, sortBy]);

  const hasChanges = useMemo(() => {
    if (!currentJob) return false;
    const savedPiano = new Set(currentJob.piano_tracks || []);
    const savedSpeaker = new Set(currentJob.speaker_tracks || []);
    const savedMale = new Set(currentJob.vocal_male_tracks || []);
    const savedFemale = new Set(currentJob.vocal_female_tracks || []);
    
    if (pianoTracks.size !== savedPiano.size) return true;
    if (speakerTracks.size !== savedSpeaker.size) return true;
    if (vocalMaleTracks.size !== savedMale.size) return true;
    if (vocalFemaleTracks.size !== savedFemale.size) return true;
    
    for (const id of pianoTracks) {
      if (!savedPiano.has(id)) return true;
    }
    for (const id of speakerTracks) {
      if (!savedSpeaker.has(id)) return true;
    }
    for (const id of vocalMaleTracks) {
      if (!savedMale.has(id)) return true;
    }
    for (const id of vocalFemaleTracks) {
      if (!savedFemale.has(id)) return true;
    }
    
    if (pedalPreset !== currentJob.pedal_preset) return true;
    if (rhythmFactor !== currentJob.rhythm_factor) return true;
    if (melodyFactor !== currentJob.melody_factor) return true;
    
    return false;
  }, [currentJob, pianoTracks, speakerTracks, vocalMaleTracks, vocalFemaleTracks, pedalPreset, rhythmFactor, melodyFactor]);

  useEffect(() => {
    if (!currentJob) return;
    if (currentJob.status !== 'completed' || hasChanges) {
      setPlaybackMode('preview');
    } else {
      setPlaybackMode('performance');
    }
  }, [currentJob?.status, hasChanges]);

  const openUnifiedWorkspace = async (jobId: string) => {
    const job = jobs.find(j => j.job_id === jobId);
    if (!job) return;

    setSelectedJobId(jobId);
    setPianoTracks(new Set(job.piano_tracks || []));
    setSpeakerTracks(new Set(job.speaker_tracks || []));
    setVocalMaleTracks(new Set(job.vocal_male_tracks || []));
    setVocalFemaleTracks(new Set(job.vocal_female_tracks || []));
    setPedalPreset(job.pedal_preset || 'light');
    setRhythmFactor(job.rhythm_factor ?? 1.0);
    setMelodyFactor(job.melody_factor ?? 1.0);
    const impVoc = job.imported_vocals || null;
    setImportedVocalsJobId(impVoc?.mp3_job_id || null);
    setImportedVocalsOriginalName(impVoc?.original_name || null);
    setImportedVocalsDelayMs(impVoc?.delay_ms || 0);
    setImportedVocalsEnabled(impVoc?.enabled ?? true);
    setImportedVocalsVolumeFactor(impVoc?.volume_factor ?? 1.0);
    setImportedVocalsBreaklines(impVoc?.breaklines || []);
    setMp3VocalsPosition(impVoc?.position ?? null);
    setVocalsWaveformEnvelope(null);
    setLoopStartMs(null);
    setLoopEndMs(null);
    setLoopEnabled(false);

    setLoading(true);
    try {
      if (impVoc?.mp3_job_id) {
        try {
          const waveData = await midiOrchestratorApi.getVocalsWaveform(impVoc.mp3_job_id);
          setVocalsWaveformEnvelope(waveData.envelope || null);
        } catch (waveErr) {
          console.error("Failed to fetch vocals waveform:", waveErr);
        }
      }
      // 1. Fetch note events for the lanes
      const noteData = await midiOrchestratorApi.getNotes(jobId);
      setNotes(noteData);

      // 2. Clear old sound refs
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      if (previewSoundRef.current) {
        await previewSoundRef.current.unloadAsync();
        previewSoundRef.current = null;
      }

      // 3. If job is completed, pre-load backing audio for performance play
      if (job.status === 'completed') {
        const url = midiOrchestratorApi.getBackingAudioUrl(jobId);
        const { sound } = await Audio.Sound.createAsync(
          { uri: url },
          { shouldPlay: false, progressUpdateIntervalMillis: 100 },
          onPlaybackStatusUpdate
        );
        soundRef.current = sound;
      }

      setStage('visualizer');
    } catch (e: any) {
      console.error(e);
      Alert.alert('Workspace Error', 'Failed to load visualizer workspace.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenMp3ImportModal = async () => {
    try {
      setLoading(true);
      const jobsList = await mp3Api.listJobs();
      const completed = jobsList.filter((j: any) => j.status === 'completed' && j.vocals);
      setMp3Jobs(completed);
      setShowMp3ImportModal(true);
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', 'Failed to fetch MP3 orchestrator library.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectMp3Vocals = async (mp3JobId: string) => {
    try {
      setShowMp3ImportModal(false);
      const job = mp3Jobs.find(j => j.job_id === mp3JobId);
      const origName = job?.original_name || job?.filename || 'Untitled MP3 Job';
      
      const applySelection = async (keep: boolean) => {
        try {
          setLoading(true);
          setImportedVocalsJobId(mp3JobId);
          setImportedVocalsOriginalName(origName);
          setImportedVocalsEnabled(true);
          
          if (!keep) {
            setImportedVocalsDelayMs(0);
            setImportedVocalsVolumeFactor(1.0);
            setImportedVocalsBreaklines([]);
          }
          
          const waveData = await midiOrchestratorApi.getVocalsWaveform(mp3JobId);
          setVocalsWaveformEnvelope(waveData.envelope || null);
        } catch (e: any) {
          console.error(e);
          Alert.alert('Waveform Error', 'Could not load vocal waveform details.');
        } finally {
          setLoading(false);
        }
      };

      if (importedVocalsBreaklines && importedVocalsBreaklines.length > 0) {
        if (Platform.OS === 'web') {
          const retain = window.confirm(
            'Would you like to RETAIN your existing breakline sync adjustments for the new track?\n\n' +
            'Click OK to Retain adjustments.\n' +
            'Click Cancel to choose Clear or Cancel.'
          );
          if (retain) {
            await applySelection(true);
          } else {
            const clear = window.confirm(
              'Would you like to CLEAR all adjustments for the new track?\n\n' +
              'Click OK to Clear adjustments.\n' +
              'Click Cancel to Abort track swapping.'
            );
            if (clear) {
              await applySelection(false);
            }
          }
        } else {
          Alert.alert(
            'Existing Adjustments',
            'Would you like to retain your existing breakline sync adjustments for the new track?',
            [
              {
                text: 'Retain Adjustments',
                onPress: () => applySelection(true),
              },
              {
                text: 'Clear Adjustments',
                onPress: () => applySelection(false),
                style: 'destructive',
              },
              {
                text: 'Cancel',
                onPress: () => {},
                style: 'cancel',
              }
            ]
          );
        }
      } else {
        await applySelection(false);
      }
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', 'An unexpected error occurred while selecting the track.');
    }
  };

  const handleVocalsLongPress = (locationX: number) => {
    const tMs = Math.round((locationX / PIXELS_PER_SECOND) * 1000);
    setTooltipTimeMs(tMs);
    setShowTooltip(true);
  };

  const handleAddBreakline = () => {
    const playPos = Math.round(playbackPos);
    if (importedVocalsBreaklines.some(b => b.time_ms === playPos)) {
      Alert.alert('Duplicate Marker', 'A breakline already exists at this timestamp.');
      return;
    }
    
    let initialOffset = importedVocalsDelayMs;
    const sorted = [...importedVocalsBreaklines].sort((a,b) => a.time_ms - b.time_ms);
    for (const b of sorted) {
      if (b.time_ms < playPos) {
        initialOffset = b.offset_ms;
      } else {
        break;
      }
    }

    const updated = [...importedVocalsBreaklines, { time_ms: playPos, offset_ms: initialOffset }]
      .sort((a, b) => a.time_ms - b.time_ms);
    setImportedVocalsBreaklines(updated);
  };

  const handleUpdateBreaklineOffset = (index: number, delta: number) => {
    const updated = importedVocalsBreaklines.map((b, i) => {
      if (i === index) {
        return { ...b, offset_ms: b.offset_ms + delta };
      }
      return b;
    });
    setImportedVocalsBreaklines(updated);
  };

  const handleDeleteBreakline = (index: number) => {
    const updated = importedVocalsBreaklines.filter((_, i) => i !== index);
    setImportedVocalsBreaklines(updated);
  };

  const handleDeleteLoopStart = () => {
    setLoopStartMs(null);
    setLoopEnabled(false);
  };

  const handleDeleteLoopEnd = () => {
    setLoopEndMs(null);
    setLoopEnabled(false);
  };

  const handleToggleTrackRole = (trackIndex: number, role: 'piano' | 'speakers' | 'male_vocal' | 'female_vocal' | 'mute') => {
    if (isPreviewPlaying) {
      stopPreview();
    }
    if (isPlaying) {
      stopPlayback();
    }

    setPianoTracks(prev => {
      const next = new Set(prev);
      if (role === 'piano') next.add(trackIndex);
      else next.delete(trackIndex);
      return next;
    });

    setSpeakerTracks(prev => {
      const next = new Set(prev);
      if (role === 'speakers') next.add(trackIndex);
      else next.delete(trackIndex);
      return next;
    });

    setVocalMaleTracks(prev => {
      const next = new Set(prev);
      if (role === 'male_vocal') next.add(trackIndex);
      else next.delete(trackIndex);
      return next;
    });

    setVocalFemaleTracks(prev => {
      const next = new Set(prev);
      if (role === 'female_vocal') next.add(trackIndex);
      else next.delete(trackIndex);
      return next;
    });
  };

  // Load jobs list
  const fetchJobs = async () => {
    try {
      const [data, pData] = await Promise.all([
        midiOrchestratorApi.listJobs(),
        playlistApi.listPlaylists().catch(() => ({}))
      ]);
      if (pData) {
        useStore.getState().setPlaylists(pData);
      }
      const storePlaylists = pData || useStore.getState().playlists || {};
      const enrichedJobs = data.map((j: any) => {
        const plSet = new Set<string>(j.playlists || []);
        const hybridKey = `hybrid:${j.job_id}`;
        Object.entries(storePlaylists).forEach(([plName, plValue]: [string, any]) => {
          const tracks = Array.isArray(plValue) ? plValue : plValue?.tracks || [];
          if (tracks.includes(hybridKey) || (j.filename && tracks.includes(j.filename))) {
            plSet.add(plName);
          }
        });
        return { ...j, playlists: Array.from(plSet) };
      });
      setJobs(enrichedJobs);
    } catch (e) {
      console.error('Failed to load midi jobs', e);
    }
  };

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      setLoading(true);
      fetchJobs().finally(() => setLoading(false));
    });
    return () => {
      task.cancel();
      stopPlayback();
      stopPreview();
    };
  }, []);

  // Poll job status if any is processing
  useEffect(() => {
    const hasProcessing = jobs.some(j => j.status === 'processing' || j.status === 'synthesizing');
    let timer: any;
    if (hasProcessing) {
      timer = setInterval(fetchJobs, 2000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [jobs]);

  // Handle MIDI Upload
  const handleUpload = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['audio/midi', 'audio/x-midi', 'audio/mid', '*/*'],
        copyToCacheDirectory: true,
        multiple: true
      });
      if (res.canceled || !res.assets || res.assets.length === 0) return;

      setLoading(true);
      
      const uploadedJobs = [];
      let lastJobId = null;

      for (const asset of res.assets) {
        if (!asset.name.toLowerCase().endsWith('.mid') && !asset.name.toLowerCase().endsWith('.midi')) {
          continue;
        }

        try {
          // Read file content as Base64 (using browser FileReader on Web, FileSystem on Mobile)
          let base64Data = '';
          if (Platform.OS === 'web') {
            const response = await fetch(asset.uri);
            const blob = await response.blob();
            base64Data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                const resultStr = reader.result as string;
                const base64 = resultStr.split(',')[1];
                resolve(base64);
              };
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } else {
            base64Data = await FileSystem.readAsStringAsync(asset.uri, {
              encoding: 'base64',
            });
          }

          const data = await midiOrchestratorApi.uploadBase64(asset.name, base64Data);
          uploadedJobs.push(data);
          lastJobId = data.job_id;
        } catch (err) {
          console.error(`Failed to upload ${asset.name}:`, err);
        }
      }

      await fetchJobs();

      if (uploadedJobs.length === 0) {
        Alert.alert('Upload Failed', 'No valid MIDI files were successfully uploaded.');
      } else {
        if (uploadedJobs.length === 1 && lastJobId) {
          Alert.alert('Upload Success', 'MIDI track extracted. Opening configuration workspace...');
          await openUnifiedWorkspace(lastJobId);
        } else {
          Alert.alert('Upload Success', `Successfully uploaded ${uploadedJobs.length} MIDI files.`);
        }
      }
    } catch (e: any) {
      console.error(e);
      Alert.alert('Upload Failed', e.message || 'Could not upload MIDI file.');
    } finally {
      setLoading(false);
    }
  };
 
  // Open job in workspace
  const handleJobSelect = (job: any) => {
    if (job.status === 'processing' || job.status === 'synthesizing') {
      Alert.alert('Processing', 'This file is currently being processed. Please wait...');
      return;
    }
    setMp3VocalsPosition(null);
    openUnifiedWorkspace(job.job_id);
  };

  // Delete Job
  const handleDeleteJob = async (jobId: string) => {
    const doDelete = async () => {
      try {
        setLoading(true);
        await midiOrchestratorApi.deleteJob(jobId);
        setSelectedJobs(prev => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
        await fetchJobs();
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Are you sure you want to delete this MIDI Orchestration job?')) {
        doDelete();
      }
      return;
    }

    Alert.alert(
      'Delete Job',
      'Are you sure you want to delete this MIDI Orchestration job?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete }
      ]
    );
  };

  const handleBulkDelete = () => {
    if (selectedJobs.size === 0) return;
    const doDelete = async () => {
      try {
        setLoading(true);
        const list = Array.from(selectedJobs);
        for (const id of list) {
          await midiOrchestratorApi.deleteJob(id);
        }
        setSelectedJobs(new Set());
        await fetchJobs();
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Delete ${selectedJobs.size} MIDI Orchestration jobs?`)) {
        doDelete();
      }
      return;
    }

    Alert.alert(
      'Bulk Delete',
      `Delete ${selectedJobs.size} MIDI Orchestration jobs?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete }
      ]
    );
  };

  // Context Actions Handlers
  const handleOpenContextActions = (job: any) => {
    setContextJob(job);
  };

  const handleCloseContextActions = () => {
    setContextJob(null);
  };

  const handleOpenReclean = (job: any) => {
    setContextJob(job);
    setRecleanRhythm(job.rhythm_factor || 1.0);
    setRecleanMelody(job.melody_factor || 1.0);
    setRecleanPedal(job.pedal_preset || 'light');
    setRecleanVisible(true);
  };

  const handleRunQuickReclean = async () => {
    if (!contextJob) return;
    try {
      setSystemBusy(true);
      setRecleanVisible(false);
      
      await midiOrchestratorApi.process(
        contextJob.job_id,
        contextJob.piano_tracks || [],
        contextJob.speaker_tracks || [],
        recleanPedal,
        recleanRhythm,
        recleanMelody,
        contextJob.vocal_male_tracks || [],
        contextJob.vocal_female_tracks || [],
        contextJob.imported_vocals
      );
      
      Alert.alert('Processing Started', 'The MIDI job is being re-synthesized in the background.');
      fetchJobs();
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e.message || 'Failed to start processing.');
    } finally {
      setSystemBusy(false);
      setContextJob(null);
    }
  };

  const handleOpenDetails = async (job: any) => {
    try {
      setSystemBusy(true);
      const meta = await midiOrchestratorApi.getMetadata(job.job_id);
      setContextJob(job);
      const displayTitle = getCleanTitle(meta.filename || job.filename || '');
      setDetailsTitle(displayTitle);
      setDetailsArtist(meta.artist || job.artist || '');
      setDetailsComments(meta.comments || job.comments || '');
      setDetailsRating(meta.rating || job.rating || 0);
      setDetailsGenre(meta.genre || job.genre || '');
      setDetailsMood(meta.mood || job.mood || '');
      setDetailsSource(meta.source || job.source || '');
      setDetailsDnu(meta.dnu || job.dnu || false);
      setDetailsValidated(meta.validated || job.validated || false);
      setDetailsVisible(true);
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', 'Failed to fetch job metadata.');
    } finally {
      setSystemBusy(false);
    }
  };

  const handleSaveDetails = async () => {
    if (!contextJob) return;
    try {
      setSystemBusy(true);
      setDetailsVisible(false);

      const oldTitle = getCleanTitle(contextJob.filename || '');
      const newTitle = detailsTitle.trim();
      if (newTitle && newTitle !== oldTitle) {
        const originalExt = (contextJob.filename || '').split('.').pop() || 'mid';
        const finalName = newTitle.endsWith('.' + originalExt) ? newTitle : `${newTitle}.${originalExt}`;
        await midiOrchestratorApi.rename(contextJob.job_id, finalName);
      }

      await midiOrchestratorApi.updateMetadata(contextJob.job_id, {
        artist: detailsArtist.trim(),
        comments: detailsComments.trim(),
        rating: detailsRating,
        genre: detailsGenre.trim(),
        mood: detailsMood.trim(),
        source: detailsSource.trim(),
        dnu: detailsDnu,
        validated: detailsValidated
      });

      Alert.alert('Success', 'Song metadata updated successfully.');
      fetchJobs();
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e.message || 'Failed to save metadata.');
    } finally {
      setSystemBusy(false);
      setContextJob(null);
    }
  };

  // Toggle track role
  const handleTrackRoleToggle = (trackIndex: number, role: 'piano' | 'speakers' | 'male_vocal' | 'female_vocal' | 'mute') => {
    setPianoTracks(prev => {
      const next = new Set(prev);
      if (role === 'piano') next.add(trackIndex);
      else next.delete(trackIndex);
      return next;
    });
    setSpeakerTracks(prev => {
      const next = new Set(prev);
      if (role === 'speakers') next.add(trackIndex);
      else next.delete(trackIndex);
      return next;
    });
    setVocalMaleTracks(prev => {
      const next = new Set(prev);
      if (role === 'male_vocal') next.add(trackIndex);
      else next.delete(trackIndex);
      return next;
    });
    setVocalFemaleTracks(prev => {
      const next = new Set(prev);
      if (role === 'female_vocal') next.add(trackIndex);
      else next.delete(trackIndex);
      return next;
    });
  };

  const stopPreview = async () => {
    if (previewSoundRef.current) {
      try {
        await previewSoundRef.current.stopAsync();
        await previewSoundRef.current.unloadAsync();
      } catch (e) {}
      previewSoundRef.current = null;
    }
    setIsPreviewPlaying(false);
    setIsPreviewLoading(false);
  };

  const handleTogglePreview = async () => {
    if (!selectedJobId) return;
    if (pianoTracks.size === 0 && speakerTracks.size === 0) {
      Alert.alert('No Tracks Selected', 'Choose at least one track to preview.');
      return;
    }

    if (isPreviewPlaying) {
      await stopPreview();
      return;
    }

    setIsPreviewLoading(true);
    try {
      await setAudioMode('playback');
      if (previewSoundRef.current) {
        await previewSoundRef.current.unloadAsync();
      }

      const url = midiOrchestratorApi.getPreviewUrl(
        selectedJobId, 
        Array.from(pianoTracks), 
        Array.from(speakerTracks),
        Array.from(vocalMaleTracks),
        Array.from(vocalFemaleTracks)
      );

      const initialStatus = {
        shouldPlay: true,
        progressUpdateIntervalMillis: 100,
        positionMillis: (loopEnabled && loopStartMs !== null) ? loopStartMs : 0
      };

      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        initialStatus,
        (status: any) => {
          onPlaybackStatusUpdate(status);
          if (status.didJustFinish) {
            stopPreview();
          }
        }
      );

      previewSoundRef.current = sound;
      setIsPreviewPlaying(true);
    } catch (e: any) {
      console.error(e);
      Alert.alert('Preview Failed', 'Could not generate or play local audio preview.');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Run Backend Split & Synthesize Process
  const handleProcess = async () => {
    if (!selectedJobId) return;
    if (pianoTracks.size === 0 && speakerTracks.size === 0 && vocalMaleTracks.size === 0 && vocalFemaleTracks.size === 0) {
      Alert.alert('No Tracks Selected', 'Choose at least one track for Piano, Speakers, or Vocals.');
      return;
    }

    try {
      setLoading(true);
      await midiOrchestratorApi.process(
        selectedJobId,
        Array.from(pianoTracks),
        Array.from(speakerTracks),
        pedalPreset,
        rhythmFactor,
        melodyFactor,
        Array.from(vocalMaleTracks),
        Array.from(vocalFemaleTracks),
        importedVocalsJobId ? {
          mp3_job_id: importedVocalsJobId,
          original_name: importedVocalsOriginalName || undefined,
          delay_ms: importedVocalsDelayMs,
          enabled: importedVocalsEnabled,
          volume_factor: importedVocalsVolumeFactor,
          breaklines: importedVocalsBreaklines,
          position: mp3VocalsPosition ?? undefined
        } : undefined
      );
      await fetchJobs();
      setStage('list');
      Alert.alert('Processing Started', 'Extracting piano keys and generating backing strings. Monitor progress in the jobs list.');
    } catch (e: any) {
      console.error(e);
      Alert.alert('Processing Failed', e.message || 'Could not start processing.');
    } finally {
      setLoading(false);
    }
  };

  // Sound Playback Updates
  const onPlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      // Loop check
      const { enabled: isLoop, start: lStart, end: lEnd } = loopConfigRef.current;
      if (isLoop && lStart !== null && lEnd !== null && status.isPlaying) {
        if (status.positionMillis >= lEnd) {
          if (playbackMode === 'performance') {
            soundRef.current?.setPositionAsync(lStart);
          } else {
            previewSoundRef.current?.setPositionAsync(lStart);
          }
          setPlaybackPos(lStart);
          return;
        }
      }

      setPlaybackPos(status.positionMillis);
      setPlaybackDuration(status.durationMillis || 0);

      // Scroll timeline to playhead
      if (status.isPlaying && !isSeekingRef.current) {
        const sec = status.positionMillis / 1000;
        const scrollX = Math.max(0, (sec * PIXELS_PER_SECOND) - (SCREEN_WIDTH / 3));
        scrollRef.current?.scrollTo({ x: scrollX, animated: false });
      }

      if (status.didJustFinish) {
        stopPlayback();
      }
    }
  };

  // Sync Playback Controllers
  const startPlayback = async () => {
    if (!soundRef.current || !selectedJobId) {
      Alert.alert('Playback Error', 'Backing audio is not loaded or ready.');
      return;
    }

    try {
      await setAudioMode('playback');
      setSystemBusy(true);
      setIsPlaying(true);

      if (loopEnabled && loopStartMs !== null) {
        await soundRef.current.setPositionAsync(loopStartMs);
        setPlaybackPos(loopStartMs);
      }

      const isSynthesizedPlay = pianoTracks.size > 0;
      const useBackendRoute = backendAudioEnabled && isSynthesizedPlay;

      // Set volume before playing
      await soundRef.current.setStatusAsync({ volume: useBackendRoute ? 0.0 : 1.0 });

      const playPianoMidi = async () => {
        if (isSynthesizedPlay || useBackendRoute) {
          try {
            await midiOrchestratorApi.playMidi(selectedJobId, globalOffset);
          } catch (e: any) {
            console.error('Backend play failed', e);
            const msg = e.response?.data?.detail || e.message || 'Unknown error';
            Alert.alert('Playback Error', `Failed to play backend audio/keys: ${msg}`);
          }
        }
      };

      if (globalOffset >= 0) {
        // Play local backing audio immediately
        await soundRef.current.playAsync();
        
        if (globalOffset > 0) {
          playbackTimerRef.current = setTimeout(async () => {
            await playPianoMidi();
          }, globalOffset);
        } else {
          await playPianoMidi();
        }
      } else {
        // Play disklavier MIDI immediately
        await playPianoMidi();
        
        // Delay backing audio
        playbackTimerRef.current = setTimeout(async () => {
          if (soundRef.current) {
            await soundRef.current.playAsync();
          }
        }, Math.abs(globalOffset));
      }
    } catch (e: any) {
      console.error(e);
      setIsPlaying(false);
      setSystemBusy(false);
      const msg = e.response?.data?.detail || e.message || 'Unknown error';
      Alert.alert('Playback Error', `Failed to start synchronized playback: ${msg}`);
    }
  };

  const pausePlayback = async () => {
    if (playbackTimerRef.current) {
      clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    if (soundRef.current) {
      await soundRef.current.pauseAsync();
    }
    await pianoApi.stop();
    setIsPlaying(false);
    setSystemBusy(false);
  };

  const stopPlayback = async () => {
    if (playbackTimerRef.current) {
      clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
      } catch (e) {}
    }
    await pianoApi.stop();
    setIsPlaying(false);
    setSystemBusy(false);
    setPlaybackPos(0);
    scrollRef.current?.scrollTo({ x: 0, animated: true });
  };

  // Format Duration helper
  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const secs = s % 60;
    return `${m}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Color picker for tracks/visualizer
  const getTrackColor = (trackIndex: number, isPiano: boolean, isSpeaker: boolean) => {
    if (isPiano) return themeColors.accent; // Vibrant Blue/Cyan
    if (isSpeaker) return '#a29bfe'; // Light purple for strings/speakers
    return themeColors.textMuted;
  };

  // visualizer math functions
  const getLanesData = useMemo(() => {
    if (!currentJob || !notes) return [];
    
    // Build lanes only for tracks containing notes
    const lanes = currentJob.tracks.filter((t: any) => {
      const trackNotes = notes[String(t.index)] || [];
      return trackNotes.length > 0;
    }).map((track: any) => {
      const trackNotes = notes[String(track.index)] || [];
      const pitches = trackNotes.map(n => n.pitch);
      const minPitch = pitches.length > 0 ? Math.min(...pitches) : 40;
      const maxPitch = pitches.length > 0 ? Math.max(...pitches) : 80;
      const pitchRange = Math.max(12, maxPitch - minPitch); // avoid division by zero, min 1 octave height scale
      
      return {
        ...track,
        notes: trackNotes,
        minPitch,
        maxPitch,
        pitchRange
      };
    });

    if (importedVocalsJobId) {
      const vocalsLane = {
        index: -99,
        name: "🎙️ MP3 Vocals",
        program: -1,
        instrument_name: "Audio Stems",
        is_drum: false,
        note_count: 0,
        duration: 0.0,
        notes: [],
        minPitch: 0,
        maxPitch: 0,
        pitchRange: 1
      };

      const targetPos = (mp3VocalsPosition !== null && mp3VocalsPosition >= 0 && mp3VocalsPosition <= lanes.length)
        ? mp3VocalsPosition
        : lanes.length;

      lanes.splice(targetPos, 0, vocalsLane);
    }

    return lanes;
  }, [currentJob, notes, importedVocalsJobId, mp3VocalsPosition]);

  const isDraggingMp3Ref = useRef(isDraggingMp3Vocals);
  isDraggingMp3Ref.current = isDraggingMp3Vocals;
  const getLanesDataRef = useRef<any[]>([]);
  getLanesDataRef.current = getLanesData;

  const startMp3Drag = (clientY: number) => {
    dragStartYRef.current = clientY;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      const currentIdx = getLanesData.findIndex(l => l.index === -99);
      if (currentIdx !== -1) {
        mp3StartPosRef.current = currentIdx;
        setIsDraggingMp3Vocals(true);
      }
    }, 200);
  };

  const moveMp3Drag = (clientY: number) => {
    if (!isDraggingMp3Vocals && longPressTimerRef.current) {
      if (Math.abs(clientY - dragStartYRef.current) > 15) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      return;
    }
    if (isDraggingMp3Vocals) {
      const dy = clientY - dragStartYRef.current;
      const stepDelta = Math.round(dy / LANE_HEIGHT);
      const totalLanes = getLanesData.length;
      const newPos = Math.max(0, Math.min(totalLanes - 1, mp3StartPosRef.current + stepDelta));
      setMp3VocalsPosition(newPos);
    }
  };

  const endMp3Drag = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setIsDraggingMp3Vocals(false);
  };

  const mp3PanResponder = useMemo(() => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return isDraggingMp3Ref.current || Math.abs(gestureState.dy) > 10;
      },
      onMoveShouldSetPanResponderCapture: (_, gestureState) => isDraggingMp3Ref.current,
      onPanResponderGrant: (evt) => {
        dragStartYRef.current = evt.nativeEvent.pageY;
        const currentIdx = getLanesDataRef.current.findIndex(l => l.index === -99);
        if (currentIdx !== -1) {
          mp3StartPosRef.current = currentIdx;
        }
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = setTimeout(() => {
          setIsDraggingMp3Vocals(true);
        }, 200);
      },
      onPanResponderMove: (_, gestureState) => {
        if (!isDraggingMp3Ref.current) {
          if (Math.abs(gestureState.dy) > 15 && longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
          }
          return;
        }
        const stepDelta = Math.round(gestureState.dy / LANE_HEIGHT);
        const totalLanes = getLanesDataRef.current.length;
        const newPos = Math.max(0, Math.min(totalLanes - 1, mp3StartPosRef.current + stepDelta));
        setMp3VocalsPosition(newPos);
      },
      onPanResponderRelease: () => {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        setIsDraggingMp3Vocals(false);
      },
      onPanResponderTerminate: () => {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        setIsDraggingMp3Vocals(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!isDraggingMp3Vocals) return;
    const handleWindowMove = (e: MouseEvent | TouchEvent) => {
      const pageY = 'touches' in e && e.touches[0] ? e.touches[0].pageY : (e as MouseEvent).pageY;
      if (pageY !== undefined) {
        moveMp3Drag(pageY);
      }
    };
    const handleWindowEnd = () => {
      endMp3Drag();
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('mousemove', handleWindowMove);
      window.addEventListener('mouseup', handleWindowEnd);
      window.addEventListener('touchmove', handleWindowMove);
      window.addEventListener('touchend', handleWindowEnd);
      return () => {
        window.removeEventListener('mousemove', handleWindowMove);
        window.removeEventListener('mouseup', handleWindowEnd);
        window.removeEventListener('touchmove', handleWindowMove);
        window.removeEventListener('touchend', handleWindowEnd);
      };
    }
  }, [isDraggingMp3Vocals]);

  // Timeline render item notes
  const renderVisualizerTimeline = () => {
    const durationSec = playbackDuration / 1000 || currentJob?.tracks[0]?.duration || 180;
    const timelineWidth = durationSec * PIXELS_PER_SECOND;
    
    // Calculate totalHeight and individual lane offsets dynamically
    let totalHeight = 0;
    const laneOffsets: number[] = [];
    const laneHeights: number[] = [];
    getLanesData.forEach((lane) => {
      laneOffsets.push(totalHeight);
      const h = lane.index === -99 ? 120 : LANE_HEIGHT;
      laneHeights.push(h);
      totalHeight += h;
    });

    return (
      <ScrollView 
        style={[styles.verticalLanesScrollView, { backgroundColor: themeColors.background }]}
        contentContainerStyle={{ flexGrow: 1 }}
        removeClippedSubviews={true}
      >
        <View style={styles.visualizerContainer}>
          {/* Left Track Names Sidebar */}
          <View style={[styles.sidebar, { borderRightColor: themeColors.border, backgroundColor: themeColors.surface, height: totalHeight }]}>
          {getLanesData.map((lane: any) => {
            const isPiano = pianoTracks.has(lane.index);
            const isSpeaker = speakerTracks.has(lane.index);
            const isMale = vocalMaleTracks.has(lane.index);
            const isFemale = vocalFemaleTracks.has(lane.index);
            const isMuted = !isPiano && !isSpeaker && !isMale && !isFemale;
            
            if (lane.index === -99) {
              return (
                <View 
                  key="-99" 
                  style={[
                    styles.sidebarLane, 
                    { 
                      height: 120, 
                      borderBottomColor: themeColors.border, 
                      paddingHorizontal: 8, 
                      justifyContent: 'center',
                      backgroundColor: isDraggingMp3Vocals ? 'rgba(232, 67, 147, 0.25)' : themeColors.surface,
                      borderColor: isDraggingMp3Vocals ? '#e84393' : 'transparent',
                      borderWidth: isDraggingMp3Vocals ? 2 : 0,
                      elevation: isDraggingMp3Vocals ? 8 : 0,
                      zIndex: isDraggingMp3Vocals ? 999 : 1,
                    }
                  ]}
                >
                  {/* Top Half: Drag Handle & Track Info (Only Area with Drag Listener) */}
                  <View 
                    {...mp3PanResponder.panHandlers}
                    onTouchStart={(e: any) => startMp3Drag(e.touches?.[0]?.pageY || e.nativeEvent?.pageY || 0)}
                    onTouchEnd={endMp3Drag}
                    {...(Platform.OS === 'web' ? {
                      onMouseDown: (e: any) => startMp3Drag(e.pageY || e.clientY || 0),
                      onMouseUp: endMp3Drag
                    } as any : {})}
                    style={{ 
                      flexDirection: 'row', 
                      justifyContent: 'space-between', 
                      alignItems: 'center', 
                      marginBottom: 8,
                      paddingVertical: 6,
                      paddingHorizontal: 4,
                      borderRadius: 6,
                      backgroundColor: 'rgba(232, 67, 147, 0.08)',
                      ...(Platform.OS === 'web' ? { cursor: isDraggingMp3Vocals ? 'grabbing' : 'grab' } as any : {})
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 6 }}>
                      <Ionicons 
                        name="reorder-two" 
                        size={20} 
                        color={isDraggingMp3Vocals ? "#e84393" : themeColors.textMuted} 
                        style={{ marginRight: 4 }} 
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.sidebarLaneTitle, { color: themeColors.text, fontWeight: 'bold' }]} numberOfLines={1}>
                          🎙️ MP3 Vocals
                        </Text>
                        {isDraggingMp3Vocals ? (
                          <Text style={{ fontSize: 9, color: '#e84393', fontWeight: 'bold' }}>Dragging track...</Text>
                        ) : (
                          <Text style={{ fontSize: 8, color: themeColors.textMuted }}>Hold header to drag</Text>
                        )}
                      </View>
                    </View>
                    <TouchableOpacity 
                      style={[
                        styles.allocToggleBtn, 
                        importedVocalsEnabled ? { backgroundColor: '#e84393' } : { backgroundColor: themeColors.border }
                      ]}
                      onPress={() => setImportedVocalsEnabled(!importedVocalsEnabled)}
                    >
                      <Ionicons name={importedVocalsEnabled ? "volume-high" : "volume-mute"} size={12} color="#fff" />
                    </TouchableOpacity>
                  </View>
                  
                  {/* Bottom Half: Delay controls (Isolated from Drag Handlers) */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 }}>
                    <HoldableButton 
                      style={{ paddingVertical: 8, paddingHorizontal: 16, minWidth: 54, backgroundColor: themeColors.border, borderRadius: 6, alignItems: 'center' }}
                      onPressAction={() => setImportedVocalsDelayMs(prev => prev - 50)}
                    >
                      <Text style={{ fontSize: 11, color: themeColors.text, fontWeight: 'bold' }}>-50</Text>
                    </HoldableButton>
                    
                    <Text style={{ fontSize: 11, color: themeColors.text, fontWeight: 'bold' }}>
                      {importedVocalsDelayMs >= 0 ? `+${importedVocalsDelayMs}` : importedVocalsDelayMs}ms
                    </Text>
                    
                    <HoldableButton 
                      style={{ paddingVertical: 8, paddingHorizontal: 16, minWidth: 54, backgroundColor: themeColors.border, borderRadius: 6, alignItems: 'center' }}
                      onPressAction={() => setImportedVocalsDelayMs(prev => prev + 50)}
                    >
                      <Text style={{ fontSize: 11, color: themeColors.text, fontWeight: 'bold' }}>+50</Text>
                    </HoldableButton>
                  </View>
                </View>
              );
            }

            return (
              <View key={lane.index} style={[styles.sidebarLane, { height: LANE_HEIGHT, borderBottomColor: themeColors.border }]}>
                <Text style={[styles.sidebarLaneTitle, { color: themeColors.text }]} numberOfLines={1}>
                  {lane.name}
                </Text>
                
                {/* 5-Way Live Toggle Row */}
                <View style={styles.allocationRow}>
                  {/* Piano */}
                  <TouchableOpacity 
                    style={[
                      styles.allocToggleBtn, 
                      isPiano && { backgroundColor: themeColors.accent }
                    ]}
                    onPress={() => handleToggleTrackRole(lane.index, 'piano')}
                  >
                    <Ionicons name="musical-notes" size={12} color={isPiano ? "#fff" : themeColors.textMuted} />
                  </TouchableOpacity>

                  {/* Speakers (Instruments) */}
                  <TouchableOpacity 
                    style={[
                      styles.allocToggleBtn, 
                      isSpeaker && { backgroundColor: '#a29bfe' }
                    ]}
                    onPress={() => handleToggleTrackRole(lane.index, 'speakers')}
                  >
                    <Ionicons name="volume-high" size={12} color={isSpeaker ? "#fff" : themeColors.textMuted} />
                  </TouchableOpacity>

                  {/* Male Vocal */}
                  <TouchableOpacity 
                    style={[
                      styles.allocToggleBtn, 
                      isMale && { backgroundColor: '#0984e3' }
                    ]}
                    onPress={() => handleToggleTrackRole(lane.index, 'male_vocal')}
                  >
                    <Ionicons name="man" size={12} color={isMale ? "#fff" : themeColors.textMuted} />
                  </TouchableOpacity>

                  {/* Female Vocal */}
                  <TouchableOpacity 
                    style={[
                      styles.allocToggleBtn, 
                      isFemale && { backgroundColor: '#e84393' }
                    ]}
                    onPress={() => handleToggleTrackRole(lane.index, 'female_vocal')}
                  >
                    <Ionicons name="woman" size={12} color={isFemale ? "#fff" : themeColors.textMuted} />
                  </TouchableOpacity>

                  {/* Mute */}
                  <TouchableOpacity 
                    style={[
                      styles.allocToggleBtn, 
                      isMuted && { backgroundColor: themeColors.border }
                    ]}
                    onPress={() => handleToggleTrackRole(lane.index, 'mute')}
                  >
                    <Ionicons name="volume-mute" size={12} color={isMuted ? themeColors.text : themeColors.textMuted} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
          </View>

          {/* Scrollable Lanes Grid */}
          <ScrollView 
            horizontal 
            ref={scrollRef}
            showsHorizontalScrollIndicator={true}
            style={[styles.lanesScrollView, { backgroundColor: themeColors.background, height: totalHeight }]}
            removeClippedSubviews={true}
          >
            <View style={{ width: timelineWidth, height: totalHeight }}>
            <NoteGrid
              lanesData={getLanesData}
              pianoTracks={pianoTracks}
              speakerTracks={speakerTracks}
              vocalMaleTracks={vocalMaleTracks}
              vocalFemaleTracks={vocalFemaleTracks}
              themeColors={themeColors}
              durationSec={durationSec}
              timelineWidth={timelineWidth}
              totalHeight={totalHeight}
              importedVocalsEnabled={importedVocalsEnabled}
              importedVocalsDelayMs={importedVocalsDelayMs}
              vocalsWaveformEnvelope={vocalsWaveformEnvelope}
              importedVocalsBreaklines={importedVocalsBreaklines}
              loopStartMs={loopStartMs}
              loopEndMs={loopEndMs}
              loopEnabled={loopEnabled}
              laneOffsets={laneOffsets}
              laneHeights={laneHeights}
              finetuneTimeMs={finetuneTimeMs}
              finetuneMode={finetuneMode}
              onUpdateBreakline={handleUpdateBreaklineOffset}
              onDeleteBreakline={handleDeleteBreakline}
              onDeleteLoopStart={handleDeleteLoopStart}
              onDeleteLoopEnd={handleDeleteLoopEnd}
              onLongPressVocals={handleVocalsLongPress}
            />

            {/* Glowing Vertical Playhead */}
            <View 
              style={[
                styles.playheadLine, 
                { 
                  left: (playbackPos / 1000) * PIXELS_PER_SECOND, 
                  height: totalHeight,
                  backgroundColor: themeColors.accent
                }
              ]} 
            />
          </View>
        </ScrollView>
      </View>
      </ScrollView>
    );
  };

  const handleExitWorkspace = () => {
    stopPlayback();
    stopPreview();
    setStage('list');
  };

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      
      {/* 1. LIST STAGE */}
      {stage === 'list' && (
        <View style={styles.listContainer}>
          {/* Action Bar for multi-select */}
          {selectedJobs.size > 0 && (
            <View style={[styles.actionBar, { backgroundColor: themeColors.accent }]}>
              <TouchableOpacity style={styles.actionCount} onPress={clearSelection}>
                <Ionicons name="close-circle" size={24} color="#fff" />
                <Text style={styles.actionCountText}>{selectedJobs.size}</Text>
              </TouchableOpacity>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionButtons}>
                {selectedJobs.size === 1 && (
                  <>
                    <TouchableOpacity style={styles.barBtn} onPress={() => {
                      const jobId = Array.from(selectedJobs)[0];
                      const job = jobs.find(j => j.job_id === jobId);
                      if (job) {
                        clearSelection();
                        handleJobSelect(job);
                      }
                    }}>
                      <Ionicons name="create-outline" size={20} color="#fff" />
                      <Text style={styles.barBtnText}>Workspace</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.barBtn} onPress={() => {
                      const jobId = Array.from(selectedJobs)[0];
                      const job = jobs.find(j => j.job_id === jobId);
                      if (job) {
                        clearSelection();
                        handleOpenReclean(job);
                      }
                    }}>
                      <Ionicons name="sparkles-outline" size={20} color="#fff" />
                      <Text style={styles.barBtnText}>Re-clean</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.barBtn} onPress={() => {
                      const jobId = Array.from(selectedJobs)[0];
                      const job = jobs.find(j => j.job_id === jobId);
                      if (job) {
                        clearSelection();
                        handleOpenDetails(job);
                      }
                    }}>
                      <Ionicons name="information-circle-outline" size={20} color="#fff" />
                      <Text style={styles.barBtnText}>Details</Text>
                    </TouchableOpacity>
                  </>
                )}

                <TouchableOpacity style={styles.barBtn} onPress={handleBulkDelete}>
                  <Ionicons name="trash-outline" size={20} color="#fff" />
                  <Text style={[styles.barBtnText, { color: '#fff' }]}>Delete</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          )}

          <View style={[styles.header, { borderBottomColor: themeColors.border, borderBottomWidth: 1, paddingBottom: 15, paddingTop: 10, flexDirection: 'column', alignItems: 'stretch' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <TextInput 
                style={[styles.searchBar, { flex: 1, backgroundColor: themeColors.surface, color: themeColors.text, marginBottom: 0 }]} 
                placeholder="Search jobs..." 
                placeholderTextColor={themeColors.textMuted} 
                value={search} 
                onChangeText={setSearch} 
              />
              <TouchableOpacity 
                onPress={fetchJobs} 
                disabled={loading}
                style={{ padding: 5 }}
              >
                {loading ? (
                  <ActivityIndicator size="small" color={themeColors.accent} />
                ) : (
                  <Ionicons name="refresh" size={24} color={themeColors.accent} />
                )}
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.uploadBtn, { backgroundColor: themeColors.accent, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, height: 42 }]} 
                onPress={handleUpload}
                disabled={loading}
              >
                <Ionicons name="cloud-upload" size={16} color="#fff" style={{ marginRight: 4 }} />
                <Text style={[styles.uploadBtnText, { color: '#fff', fontSize: 13, fontWeight: '600' }]}>Upload</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.sortBar}>
              {['name', 'artist', 'rating', 'created', 'length'].map((s) => (
                <TouchableOpacity 
                  key={s} 
                  onPress={() => setSortBy(s as any)} 
                  style={[styles.sortBtn, sortBy === s ? { backgroundColor: themeColors.accent } : { backgroundColor: themeColors.surfaceSecondary }]}
                >
                  <Text style={[styles.sortBtnText, sortBy === s ? { color: '#fff' } : { color: themeColors.text }]}>
                    {s === 'created' ? 'Date' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {loading && jobs.length === 0 ? (
            <ActivityIndicator size="large" color={themeColors.accent} style={{ marginTop: 50 }} />
          ) : (
            <FlatList
              data={filteredJobs}
              keyExtractor={item => item.job_id}
              contentContainerStyle={{ paddingBottom: 100 }}
              extraData={selectedJobs}
              renderItem={({ item }) => {
                const isSelected = selectedJobs.has(item.job_id);
                return (
                  <TouchableOpacity 
                    style={[
                      styles.jobCard, 
                      isSelected && { backgroundColor: themeColors.accentLight }, 
                      { borderBottomColor: themeColors.border }
                    ]}
                    onPress={() => {
                      if (selectedJobs.size > 0) {
                        toggleSelect(item.job_id);
                      } else {
                        handleJobSelect(item);
                      }
                    }}
                    onLongPress={() => toggleSelect(item.job_id)}
                  >
                    <View style={styles.selectionIndicator}>
                      <Ionicons 
                        name={isSelected ? "checkmark-circle" : "ellipse-outline"} 
                        size={22} 
                        color={isSelected ? themeColors.accent : themeColors.textMuted} 
                      />
                    </View>

                    <View style={styles.jobInfo}>
                      {/* Row 1: Title & Playlist tags */}
                      <View style={styles.titleRow}>
                        <Text style={[styles.jobFilename, { color: themeColors.text }]} numberOfLines={1}>
                          {getCleanTitle(item.filename)}
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 4 }}>
                          {item.playlists?.map((pl: string) => (
                            <View key={pl} style={[styles.statusTag, { backgroundColor: getPlaylistColor(pl) }]}>
                              <Text style={styles.statusTagText}>{pl.substring(0, 4).toUpperCase()}</Text>
                            </View>
                          ))}
                        </View>
                      </View>

                      {/* Row 2: Artist */}
                      <Text style={{ fontSize: 11, color: item.artist ? themeColors.accent : themeColors.textMuted, fontWeight: '600', marginTop: -2 }} numberOfLines={1}>
                        {item.artist || 'Unknown Artist'}
                      </Text>

                      {/* Row 3: Length, Date, dynamic velocity/pedal settings, and rating stars */}
                      <View style={styles.metaRow}>
                        <Text style={[styles.jobMeta, { color: themeColors.textMuted }]}>
                          {getSongLength(item) ? `${getSongLength(item)} • ` : ''}
                          {new Date(item.timestamp * 1000).toLocaleDateString()}
                        </Text>

                        {item.status === 'completed' && (
                          <>
                            {item.melody_factor !== undefined && (
                              <View style={[styles.statBadge, { backgroundColor: themeColors.surfaceSecondary }]}>
                                <Text style={[styles.statBadgeText, { color: themeColors.textMuted }]}>M:{Math.round(item.melody_factor * 100)}%</Text>
                              </View>
                            )}
                            {item.rhythm_factor !== undefined && (
                              <View style={[styles.statBadge, { backgroundColor: themeColors.surfaceSecondary }]}>
                                <Text style={[styles.statBadgeText, { color: themeColors.textMuted }]}>R:{Math.round(item.rhythm_factor * 100)}%</Text>
                              </View>
                            )}
                            {item.pedal_preset && (
                              <View style={[styles.statBadge, { backgroundColor: themeColors.surfaceSecondary }]}>
                                <Text style={[styles.statBadgeText, { color: themeColors.textMuted }]}>P:{item.pedal_preset.charAt(0).toUpperCase()}</Text>
                              </View>
                            )}
                            {item.validated && (
                              <View style={[styles.statBadge, { backgroundColor: 'rgba(46, 204, 113, 0.15)' }]}>
                                <Text style={[styles.statBadgeText, { color: '#2ecc71', fontWeight: 'bold' }]}>V</Text>
                              </View>
                            )}
                          </>
                        )}

                        {/* Stars */}
                        {renderStars(item.rating)}

                        {/* DNU Badge */}
                        {item.dnu && (
                          <View style={[styles.statBadge, { backgroundColor: 'rgba(231, 76, 60, 0.15)' }]}>
                            <Text style={[styles.statBadgeText, { color: '#e74c3c' }]}>DNU</Text>
                          </View>
                        )}
                      </View>

                      {/* Progress details */}
                      {(item.status === 'processing' || item.status === 'synthesizing') && (
                        <View style={styles.progressContainer}>
                          <View style={[styles.progressBarBg, { backgroundColor: themeColors.surfaceSecondary }]}>
                            <View style={[styles.progressBarFill, { width: `${item.progress}%`, backgroundColor: themeColors.accent }]} />
                          </View>
                          <Text style={[styles.progressText, { color: themeColors.textMuted }]}>
                            {item.status === 'synthesizing' ? 'Rendering Strings...' : `Processing ${item.progress}%`}
                          </Text>
                        </View>
                      )}

                      {/* Failed Badge */}
                      {item.status === 'failed' && (
                        <View style={[styles.statusBadge, { backgroundColor: 'rgba(231, 76, 60, 0.15)', marginTop: 5 }]}>
                          <Ionicons name="alert-circle" size={12} color="#e74c3c" />
                          <Text style={[styles.statusText, { color: '#e74c3c' }]}>Failed: {item.error}</Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.cardActions}>
                      <Ionicons name="chevron-forward" size={20} color={themeColors.accent} />
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', marginTop: 80 }}>
                  <Ionicons name="musical-notes-outline" size={60} color={themeColors.textMuted} style={{ marginBottom: 15 }} />
                  <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>No MIDI Orchestrator jobs found.</Text>
                  <Text style={[styles.emptySubtext, { color: themeColors.textMuted }]}>Upload a multitrack MIDI file to get started.</Text>
                </View>
              }
            />
          )}

          {/* Context Actions Bottom Sheet */}
          <Modal
            visible={contextJob !== null && !recleanVisible && !detailsVisible}
            transparent
            animationType="slide"
            onRequestClose={handleCloseContextActions}
          >
            <TouchableOpacity 
              style={styles.modalOverlay} 
              activeOpacity={1} 
              onPress={handleCloseContextActions}
            >
              <View style={[styles.bottomSheetContent, { backgroundColor: themeColors.surface }]}>
                <View style={[styles.bottomSheetHeader, { borderBottomColor: themeColors.border }]}>
                  <Text style={[styles.bottomSheetTitle, { color: themeColors.text }]} numberOfLines={1}>
                    {getCleanTitle(contextJob?.filename)}
                  </Text>
                  <Text style={[styles.bottomSheetSub, { color: themeColors.textMuted }]}>
                    Select an action
                  </Text>
                </View>

                <TouchableOpacity 
                  style={[styles.bottomSheetItem, { borderBottomColor: themeColors.border }]} 
                  onPress={() => {
                    const job = contextJob;
                    handleCloseContextActions();
                    handleJobSelect(job);
                  }}
                >
                  <Ionicons name="create-outline" size={22} color={themeColors.accent} />
                  <Text style={[styles.bottomSheetItemText, { color: themeColors.text }]}>Edit Allocations (Workspace)</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.bottomSheetItem, { borderBottomColor: themeColors.border }]} 
                  onPress={() => {
                    const job = contextJob;
                    handleCloseContextActions();
                    handleOpenReclean(job);
                  }}
                >
                  <Ionicons name="sparkles-outline" size={22} color={themeColors.accent} />
                  <Text style={[styles.bottomSheetItemText, { color: themeColors.text }]}>Quick Re-clean Settings</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.bottomSheetItem, { borderBottomColor: themeColors.border }]} 
                  onPress={() => {
                    const job = contextJob;
                    handleCloseContextActions();
                    handleOpenDetails(job);
                  }}
                >
                  <Ionicons name="information-circle-outline" size={22} color={themeColors.accent} />
                  <Text style={[styles.bottomSheetItemText, { color: themeColors.text }]}>Edit Details & Rename</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.bottomSheetItem, { borderBottomColor: themeColors.border }]} 
                  onPress={() => {
                    const job = contextJob;
                    handleCloseContextActions();
                    handleDeleteJob(job.job_id);
                  }}
                >
                  <Ionicons name="trash-outline" size={22} color="#ff4d4d" />
                  <Text style={[styles.bottomSheetItemText, { color: '#ff4d4d' }]}>Delete Job</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.bottomSheetCancel, { backgroundColor: themeColors.surfaceSecondary }]} 
                  onPress={handleCloseContextActions}
                >
                  <Text style={[styles.bottomSheetCancelText, { color: themeColors.text }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </Modal>

          {/* Quick Re-clean Modal */}
          <Modal
            visible={recleanVisible}
            transparent
            animationType="fade"
            onRequestClose={() => { setRecleanVisible(false); setContextJob(null); }}
          >
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { backgroundColor: themeColors.surface }]}>
                <Text style={[styles.modalTitle, { color: themeColors.text }]}>Quick Re-clean</Text>
                <Text style={[styles.modalSubtitle, { color: themeColors.textMuted }]}>
                  Adjust velocity dynamics & pedals for {getCleanTitle(contextJob?.filename)}
                </Text>

                {/* Pedal Preset badge */}
                <View style={{ marginBottom: 20, width: '100%' }}>
                  <Text style={[styles.label, { color: themeColors.text, marginBottom: 10 }]}>Pedal Intensity</Text>
                  <View style={styles.presetBadgesRow}>
                    {['light', 'medium', 'full'].map((preset) => (
                      <TouchableOpacity
                        key={preset}
                        style={[
                          styles.presetBadge,
                          recleanPedal === preset ? { backgroundColor: themeColors.accent, borderColor: themeColors.accent } : { backgroundColor: themeColors.surface }
                        ]}
                        onPress={() => setRecleanPedal(preset as any)}
                      >
                        <Text style={[styles.presetBadgeText, { color: recleanPedal === preset ? '#fff' : themeColors.text }]}>
                          {preset.toUpperCase()}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Rhythm factor steppers */}
                <View style={styles.sliderContainer}>
                  <Text style={[styles.label, { color: themeColors.text, marginBottom: 10 }]}>Rhythm Velocity</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: themeColors.surfaceSecondary, borderRadius: 8, padding: 5 }}>
                    <TouchableOpacity 
                      onPress={() => setRecleanRhythm(prev => Math.max(0.2, Number((prev - 0.05).toFixed(2))))}
                      style={{ padding: 10 }}
                    >
                      <Ionicons name="remove-circle-outline" size={32} color={themeColors.accent} />
                    </TouchableOpacity>
                    <Text style={{ color: themeColors.accent, fontWeight: '700', fontSize: 18, minWidth: 60, textAlign: 'center' }}>
                      {Math.round(recleanRhythm * 100)}%
                    </Text>
                    <TouchableOpacity 
                      onPress={() => setRecleanRhythm(prev => Math.min(2.0, Number((prev + 0.05).toFixed(2))))}
                      style={{ padding: 10 }}
                    >
                      <Ionicons name="add-circle-outline" size={32} color={themeColors.accent} />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Melody factor steppers */}
                <View style={styles.sliderContainer}>
                  <Text style={[styles.label, { color: themeColors.text, marginBottom: 10 }]}>Melody Velocity</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: themeColors.surfaceSecondary, borderRadius: 8, padding: 5 }}>
                    <TouchableOpacity 
                      onPress={() => setRecleanMelody(prev => Math.max(0.2, Number((prev - 0.05).toFixed(2))))}
                      style={{ padding: 10 }}
                    >
                      <Ionicons name="remove-circle-outline" size={32} color={themeColors.accent} />
                    </TouchableOpacity>
                    <Text style={{ color: themeColors.accent, fontWeight: '700', fontSize: 18, minWidth: 60, textAlign: 'center' }}>
                      {Math.round(recleanMelody * 100)}%
                    </Text>
                    <TouchableOpacity 
                      onPress={() => setRecleanMelody(prev => Math.min(2.0, Number((prev + 0.05).toFixed(2))))}
                      style={{ padding: 10 }}
                    >
                      <Ionicons name="add-circle-outline" size={32} color={themeColors.accent} />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.modalActions}>
                  <TouchableOpacity 
                    style={[styles.modalBtn, { borderColor: themeColors.border, borderWidth: 1 }]}
                    onPress={() => { setRecleanVisible(false); setContextJob(null); }}
                  >
                    <Text style={{ color: themeColors.text }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.modalBtn, { backgroundColor: themeColors.accent }]}
                    onPress={handleRunQuickReclean}
                  >
                    <Text style={{ color: '#fff', fontWeight: '600' }}>Save & Synthesize</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* Edit Details & Rename Modal */}
          <Modal
            visible={detailsVisible}
            transparent
            animationType="slide"
            onRequestClose={() => { setDetailsVisible(false); setContextJob(null); }}
          >
            <View style={[styles.modalOverlay, { justifyContent: 'flex-end' }]}>
              <KeyboardAvoidingView 
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 60}
                style={{ width: '100%' }}
              >
                <View style={[styles.modalContent, { 
                  backgroundColor: themeColors.surface, 
                  borderBottomLeftRadius: 0, 
                  borderBottomRightRadius: 0,
                  maxHeight: '90%',
                  width: '100%',
                  paddingBottom: 30
                }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <Text style={[styles.modalTitle, { color: themeColors.text }]}>Song Details</Text>
                    <TouchableOpacity onPress={() => { setDetailsVisible(false); setContextJob(null); }}>
                      <Ionicons name="close" size={24} color={themeColors.text} />
                    </TouchableOpacity>
                  </View>

                  <ScrollView 
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ paddingBottom: 40 }}
                  >
                    {/* Star Rating Section */}
                    <View style={[styles.detailRow, { marginBottom: 20 }]}>
                      <View>
                        <Text style={{ color: themeColors.text, fontWeight: '600' }}>Rating</Text>
                        <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>Rate this performance</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 5 }}>
                        {[1, 2, 3, 4, 5].map((star) => (
                          <TouchableOpacity key={star} onPress={() => setDetailsRating(detailsRating === star ? 0 : star)}>
                            <Ionicons 
                              name={star <= detailsRating ? "star" : "star-outline"} 
                              size={24} 
                              color={star <= detailsRating ? '#FFD700' : themeColors.textMuted} 
                            />
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>

                    {/* Do Not Use Switch */}
                    <View style={[styles.detailRow, { marginBottom: 20 }]}>
                      <View>
                        <Text style={{ color: themeColors.text, fontWeight: '600' }}>Do Not Use (DNU)</Text>
                        <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>Mark as unsafe or poor quality</Text>
                      </View>
                      <Switch 
                        value={detailsDnu} 
                        onValueChange={setDetailsDnu} 
                        trackColor={{ false: themeColors.border, true: '#ff5252' }} 
                      />
                    </View>

                    {/* Validated Switch */}
                    <View style={[styles.detailRow, { marginBottom: 20 }]}>
                      <View>
                        <Text style={{ color: themeColors.text, fontWeight: '600' }}>Validated</Text>
                        <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>Mark this file as verified and correct</Text>
                      </View>
                      <Switch 
                        value={detailsValidated} 
                        onValueChange={setDetailsValidated} 
                        trackColor={{ false: themeColors.border, true: '#2ecc71' }} 
                      />
                    </View>

                    {/* Title / Filename Field */}
                    <View style={styles.metaField}>
                      <Text style={[styles.metaLabel, { color: themeColors.textMuted }]}>Title / Filename</Text>
                      <TextInput
                        style={[styles.metaInput, { color: themeColors.text, borderBottomColor: themeColors.border }]}
                        value={detailsTitle}
                        onChangeText={setDetailsTitle}
                        placeholder="Song title"
                        placeholderTextColor={themeColors.textMuted}
                      />
                    </View>

                    {/* Artist Field */}
                    <View style={styles.metaField}>
                      <Text style={[styles.metaLabel, { color: themeColors.textMuted }]}>Artist</Text>
                      <TextInput
                        style={[styles.metaInput, { color: themeColors.text, borderBottomColor: themeColors.border }]}
                        value={detailsArtist}
                        onChangeText={setDetailsArtist}
                        placeholder="Unknown Artist"
                        placeholderTextColor={themeColors.textMuted}
                      />
                    </View>

                    {/* Genre and Mood Row */}
                    <View style={{ flexDirection: 'row', gap: 15, marginBottom: 15 }}>
                      <View style={[styles.metaField, { flex: 1 }]}>
                        <Text style={[styles.metaLabel, { color: themeColors.textMuted }]}>Genre</Text>
                        <TextInput 
                          style={[styles.metaInput, { color: themeColors.text, borderBottomColor: themeColors.border }]} 
                          value={detailsGenre} 
                          onChangeText={setDetailsGenre}
                          placeholder="None"
                          placeholderTextColor={themeColors.textMuted}
                        />
                      </View>
                      <View style={[styles.metaField, { flex: 1 }]}>
                        <Text style={[styles.metaLabel, { color: themeColors.textMuted }]}>Mood</Text>
                        <TextInput 
                          style={[styles.metaInput, { color: themeColors.text, borderBottomColor: themeColors.border }]} 
                          value={detailsMood} 
                          onChangeText={setDetailsMood}
                          placeholder="None"
                          placeholderTextColor={themeColors.textMuted}
                        />
                      </View>
                    </View>

                    {/* Source Field */}
                    <View style={styles.metaField}>
                      <Text style={[styles.metaLabel, { color: themeColors.textMuted }]}>Source (Game/Movie)</Text>
                      <TextInput 
                        style={[styles.metaInput, { color: themeColors.text, borderBottomColor: themeColors.border }]} 
                        value={detailsSource} 
                        onChangeText={setDetailsSource}
                        placeholder="None"
                        placeholderTextColor={themeColors.textMuted}
                      />
                    </View>

                    {/* Comments Field */}
                    <View style={[styles.metaField, { marginTop: 10 }]}>
                      <Text style={[styles.metaLabel, { color: themeColors.textMuted }]}>Comments / Notes</Text>
                      <TextInput
                        style={[styles.textArea, { borderColor: themeColors.border, backgroundColor: themeColors.background, color: themeColors.text, textAlignVertical: 'top', marginTop: 5 }]}
                        value={detailsComments}
                        onChangeText={setDetailsComments}
                        placeholder="Add notes..."
                        placeholderTextColor={themeColors.textMuted}
                        multiline
                        numberOfLines={3}
                      />
                    </View>
                  </ScrollView>

                  <View style={styles.modalButtons}>
                    <TouchableOpacity 
                      style={[styles.modalBtn, styles.modalBtnFlex, { backgroundColor: themeColors.surfaceSecondary }]} 
                      onPress={() => { setDetailsVisible(false); setContextJob(null); }}
                    >
                      <Text style={{ color: themeColors.text }}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.modalBtn, styles.modalBtnFlex, { backgroundColor: themeColors.accent }]} 
                      onPress={handleSaveDetails}
                    >
                      <Text style={{ color: '#fff', fontWeight: '700' }}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </KeyboardAvoidingView>
            </View>
          </Modal>
        </View>
      )}

      {/* 2. VISUALIZER & PLAYBACK STAGE */}
      {stage === 'visualizer' && currentJob && (
        <View style={styles.visualizerStage}>
          {/* Header */}
          <View style={[styles.visualizerHeader, { borderBottomColor: themeColors.border, backgroundColor: themeColors.surface }]}>
            <TouchableOpacity onPress={handleExitWorkspace}>
              <Ionicons name="arrow-back" size={24} color={themeColors.text} />
            </TouchableOpacity>
            
            <View style={{ flex: 1, marginLeft: 15 }}>
              <Text style={[styles.visualizerFilename, { color: themeColors.text }]} numberOfLines={1}>
                {getCleanTitle(currentJob.filename)}
              </Text>
              <Text style={[styles.visualizerStateSub, { color: themeColors.textMuted }]}>
                {isPlaying ? 'Playing synced playback' : isPreviewPlaying ? 'Playing preview' : 'Playback stopped'}
              </Text>
            </View>



            {/* Settings Toggle Button */}
            <TouchableOpacity onPress={() => setShowSettings(!showSettings)} style={{ marginRight: 15 }}>
              <Ionicons 
                name={showSettings ? "options" : "options-outline"} 
                size={24} 
                color={showSettings ? themeColors.accent : themeColors.text} 
              />
            </TouchableOpacity>
            
            {/* Sync Delay Controls */}
            <View style={styles.delayControls}>
              <Text style={[styles.delayLabel, { color: themeColors.textMuted }]}>Speaker Sync</Text>
              <View style={styles.delayButtonsRow}>
                <HoldableButton 
                  style={[styles.offsetBtn, { backgroundColor: themeColors.surfaceSecondary }]}
                  onPressAction={() => {
                    const current = useStore.getState().midiOrchestrateOffset;
                    setGlobalOffset(current - 10);
                  }}
                >
                  <Text style={[styles.offsetBtnText, { color: themeColors.text }]}>-10ms</Text>
                </HoldableButton>
                <Text style={[styles.offsetValue, { color: themeColors.text, fontWeight: '700' }]}>
                  {globalOffset >= 0 ? `+${globalOffset}` : globalOffset}ms
                </Text>
                <HoldableButton 
                  style={[styles.offsetBtn, { backgroundColor: themeColors.surfaceSecondary }]}
                  onPressAction={() => {
                    const current = useStore.getState().midiOrchestrateOffset;
                    setGlobalOffset(current + 10);
                  }}
                >
                  <Text style={[styles.offsetBtnText, { color: themeColors.text }]}>+10ms</Text>
                </HoldableButton>
              </View>
            </View>
          </View>

          {/* Collapsible Settings Panel */}
          {showSettings && (
            <View style={[styles.settingsPanel, { backgroundColor: themeColors.surfaceSecondary, borderBottomColor: themeColors.border }]}>
              {/* Pedal presets */}
              <View style={styles.settingItemRow}>
                <Text style={[styles.settingItemLabel, { color: themeColors.text }]}>Pedal Preset</Text>
                <View style={styles.presetsGroup}>
                  {['light', 'medium', 'full'].map(preset => (
                    <TouchableOpacity
                      key={preset}
                      style={[
                        styles.presetBadge,
                        pedalPreset === preset ? { backgroundColor: themeColors.accent, borderColor: themeColors.accent } : { backgroundColor: themeColors.surface }
                      ]}
                      onPress={() => setPedalPreset(preset as any)}
                    >
                      <Text style={[styles.presetBadgeText, { color: pedalPreset === preset ? '#fff' : themeColors.text }]}>
                        {preset.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Rhythm Factor */}
              <View style={styles.settingItemRow}>
                <Text style={[styles.settingItemLabel, { color: themeColors.text }]}>
                  Rhythm Velocity ({rhythmFactor.toFixed(2)}x)
                </Text>
                <View style={styles.stepButtonsContainer}>
                  <TouchableOpacity 
                    style={[styles.stepBtn, { backgroundColor: themeColors.surface }]}
                    onPress={() => setRhythmFactor(prev => Math.max(0.2, Number((prev - 0.05).toFixed(2))))}
                  >
                    <Ionicons name="remove" size={16} color={themeColors.text} />
                  </TouchableOpacity>
                  
                  <Text style={[styles.stepValueText, { color: themeColors.text }]}>
                    {rhythmFactor.toFixed(2)}x
                  </Text>
                  
                  <TouchableOpacity 
                    style={[styles.stepBtn, { backgroundColor: themeColors.surface }]}
                    onPress={() => setRhythmFactor(prev => Math.min(2.0, Number((prev + 0.05).toFixed(2))))}
                  >
                    <Ionicons name="add" size={16} color={themeColors.text} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Melody Factor */}
              <View style={styles.settingItemRow}>
                <Text style={[styles.settingItemLabel, { color: themeColors.text }]}>
                  Melody Velocity ({melodyFactor.toFixed(2)}x)
                </Text>
                <View style={styles.stepButtonsContainer}>
                  <TouchableOpacity 
                    style={[styles.stepBtn, { backgroundColor: themeColors.surface }]}
                    onPress={() => setMelodyFactor(prev => Math.max(0.2, Number((prev - 0.05).toFixed(2))))}
                  >
                    <Ionicons name="remove" size={16} color={themeColors.text} />
                  </TouchableOpacity>
                  
                  <Text style={[styles.stepValueText, { color: themeColors.text }]}>
                    {melodyFactor.toFixed(2)}x
                  </Text>
                  
                  <TouchableOpacity 
                    style={[styles.stepBtn, { backgroundColor: themeColors.surface }]}
                    onPress={() => setMelodyFactor(prev => Math.min(2.0, Number((prev + 0.05).toFixed(2))))}
                  >
                    <Ionicons name="add" size={16} color={themeColors.text} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* MP3 Vocal Import Section */}
              <View style={{ height: 1, backgroundColor: themeColors.border, marginVertical: 12, opacity: 0.6 }} />

              <View style={[styles.settingItemRow, { flexDirection: 'column', alignItems: 'stretch' }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text style={[styles.settingItemLabel, { color: themeColors.text, fontWeight: 'bold' }]}>
                    MP3 Vocal Stem
                  </Text>
                  {importedVocalsJobId ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                       <TouchableOpacity 
                         onPress={handleOpenMp3ImportModal}
                         style={{ marginRight: 2 }}
                       >
                         <Ionicons name="swap-horizontal" size={18} color={themeColors.text} />
                       </TouchableOpacity>
                      <Switch
                        value={importedVocalsEnabled}
                        onValueChange={setImportedVocalsEnabled}
                        trackColor={{ false: themeColors.border, true: '#e84393' }}
                        thumbColor="#fff"
                      />
                       <TouchableOpacity 
                         onPress={() => {
                           setImportedVocalsJobId(null);
                           setImportedVocalsOriginalName(null);
                           setVocalsWaveformEnvelope(null);
                           setImportedVocalsBreaklines([]);
                         }}
                       >
                         <Ionicons name="trash-outline" size={18} color="#ff7675" />
                       </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={{ backgroundColor: themeColors.accent, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
                      onPress={handleOpenMp3ImportModal}
                    >
                      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>Link MP3 Vocals</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {importedVocalsJobId && (
                  <View style={{ marginTop: 4 }}>
                    <Text style={{ fontSize: 11, color: themeColors.textMuted, marginBottom: 8 }} numberOfLines={1}>
                      Linked: {importedVocalsOriginalName || `${importedVocalsJobId.slice(0, 18)}...`}
                    </Text>

                    {/* Volume buttons */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 6 }}>
                      <Text style={{ fontSize: 11, color: themeColors.text, width: 75 }}>Vocal Volume:</Text>
                      
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <TouchableOpacity 
                          style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: themeColors.surface, borderRadius: 6, borderWidth: 1, borderColor: themeColors.border }}
                          onPress={() => setImportedVocalsVolumeFactor(prev => Math.max(0.0, Number((prev - 0.1).toFixed(1))))}
                        >
                          <Ionicons name="remove" size={12} color={themeColors.text} />
                        </TouchableOpacity>

                        <Text style={{ fontSize: 11, color: themeColors.text, fontWeight: 'bold', minWidth: 45, textAlign: 'center' }}>
                          {Math.round(importedVocalsVolumeFactor * 100)}%
                        </Text>

                        <TouchableOpacity 
                          style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: themeColors.surface, borderRadius: 6, borderWidth: 1, borderColor: themeColors.border }}
                          onPress={() => setImportedVocalsVolumeFactor(prev => Math.min(2.0, Number((prev + 0.1).toFixed(1))))}
                        >
                          <Ionicons name="add" size={12} color={themeColors.text} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                )}

                {/* Symphony SoundFont & DSP Audio Quality Section */}
                <View style={{ height: 1, backgroundColor: themeColors.border, marginVertical: 12, opacity: 0.6 }} />

                <View style={[styles.settingItemRow, { flexDirection: 'column', alignItems: 'stretch' }]}>
                  <Text style={[styles.settingItemLabel, { color: themeColors.text, fontWeight: 'bold', marginBottom: 6 }]}>
                    Symphony SoundFont & Audio Quality
                  </Text>
                  <Text style={{ color: themeColors.textMuted, fontSize: 12, marginBottom: 8 }}>
                    Active SoundFont Engine:
                  </Text>
                  {soundfonts.length === 0 ? (
                    <Text style={{ color: themeColors.textMuted, fontSize: 11, fontStyle: 'italic' }}>
                      Scanning soundfonts in storage...
                    </Text>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingBottom: 6 }}>
                      {soundfonts.map((sf: string) => {
                        const isSelected = activeSoundfont === sf;
                        return (
                          <TouchableOpacity
                            key={sf}
                            style={[
                              {
                                paddingHorizontal: 12,
                                paddingVertical: 8,
                                borderRadius: 8,
                                borderWidth: 1,
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 6
                              },
                              isSelected 
                                ? { backgroundColor: themeColors.accentLight, borderColor: themeColors.accent } 
                                : { backgroundColor: themeColors.surface, borderColor: themeColors.border }
                            ]}
                            onPress={() => handleSelectSoundfont(sf)}
                          >
                            <Ionicons 
                              name={isSelected ? "disc" : "disc-outline"} 
                              size={14} 
                              color={isSelected ? themeColors.accent : themeColors.textMuted} 
                            />
                            <Text style={{ fontSize: 12, color: themeColors.text, fontWeight: isSelected ? '600' : '400' }}>
                              {sf}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  )}

                  {/* Reverb Toggle & Room Size */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Ionicons name="sparkles-outline" size={16} color={themeColors.accent} />
                      <Text style={{ fontSize: 12, color: themeColors.text, fontWeight: '600' }}>
                        Concert Hall Reverb DSP
                      </Text>
                    </View>
                    <Switch
                      value={reverbEnabled}
                      onValueChange={handleToggleReverb}
                      trackColor={{ false: themeColors.border, true: themeColors.accent }}
                      thumbColor="#fff"
                    />
                  </View>

                  {reverbEnabled && (
                    <View style={{ marginTop: 8 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <Text style={{ fontSize: 11, color: themeColors.textMuted }}>Hall Room Size:</Text>
                        <Text style={{ fontSize: 11, color: themeColors.text, fontWeight: 'bold' }}>
                          {Math.round(reverbRoomSize * 100)}%
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {[
                          { label: 'Studio (35%)', val: 0.35 },
                          { label: 'Concert Hall (55%)', val: 0.55 },
                          { label: 'Cathedral (80%)', val: 0.80 }
                        ].map((preset) => {
                          const isSel = Math.abs(reverbRoomSize - preset.val) < 0.08;
                          return (
                            <TouchableOpacity
                              key={preset.label}
                              style={[
                                styles.presetBadge,
                                isSel ? { backgroundColor: themeColors.accent, borderColor: themeColors.accent } : { backgroundColor: themeColors.surface }
                              ]}
                              onPress={() => handleChangeReverbRoomSize(preset.val)}
                            >
                              <Text style={[styles.presetBadgeText, { color: isSel ? '#fff' : themeColors.text }]}>
                                {preset.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  )}
                </View>
              </View>
            </View>
          )}

          {/* Timeline Visualizer lanes rendering */}
          {renderVisualizerTimeline()}

          {/* Synced Playback Controls Bar */}
          <View style={[styles.controlsBar, { backgroundColor: themeColors.surface, borderTopColor: themeColors.border }]}>
            {/* Time progress */}
            <View style={styles.timeRow}>
              <Text style={{ color: themeColors.text, fontSize: 12 }}>{formatTime(playbackPos)}</Text>
              
              {currentJob.status === 'completed' && !hasChanges ? (
                <TouchableOpacity 
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: themeColors.surfaceSecondary, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 }}
                  onPress={() => setPlaybackMode(prev => prev === 'preview' ? 'performance' : 'preview')}
                >
                  <Ionicons 
                    name={playbackMode === 'preview' ? "volume-medium" : "musical-notes"} 
                    size={14} 
                    color={playbackMode === 'preview' ? '#a29bfe' : themeColors.accent} 
                  />
                  <Text style={[styles.modeIndicatorText, { color: playbackMode === 'preview' ? '#a29bfe' : themeColors.accent, fontSize: 11 }]}>
                    {playbackMode === 'preview' ? 'Phone Speakers' : 'Disklavier Piano'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text style={[styles.modeIndicatorText, { color: '#a29bfe' }]}>
                  Preview Mode
                </Text>
              )}
              
              <Text style={{ color: themeColors.textMuted, fontSize: 12 }}>{formatTime(playbackDuration)}</Text>
            </View>

            {/* Loop Markers Bar */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: themeColors.border, opacity: 0.9 }}>
              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: loopStartMs !== null ? 'rgba(46, 204, 113, 0.2)' : themeColors.surfaceSecondary,
                  borderWidth: 1,
                  borderColor: loopStartMs !== null ? '#2ecc71' : themeColors.border
                }}
                onPress={() => setLoopStartMs(Math.round(playbackPos))}
              >
                <Ionicons name="flag" size={12} color={loopStartMs !== null ? '#2ecc71' : themeColors.text} />
                <Text style={{ fontSize: 10, color: themeColors.text, fontWeight: '600' }}>
                  {loopStartMs !== null ? `Start: ${formatTime(loopStartMs)}` : 'Set A'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: loopEndMs !== null ? 'rgba(231, 76, 60, 0.2)' : themeColors.surfaceSecondary,
                  borderWidth: 1,
                  borderColor: loopEndMs !== null ? '#e74c3c' : themeColors.border
                }}
                onPress={() => setLoopEndMs(Math.round(playbackPos))}
              >
                <Ionicons name="flag" size={12} color={loopEndMs !== null ? '#e74c3c' : themeColors.text} />
                <Text style={{ fontSize: 10, color: themeColors.text, fontWeight: '600' }}>
                  {loopEndMs !== null ? `End: ${formatTime(loopEndMs)}` : 'Set B'}
                </Text>
              </TouchableOpacity>

              {(loopStartMs !== null || loopEndMs !== null) && (
                <TouchableOpacity
                  style={{
                    paddingHorizontal: 6,
                    paddingVertical: 4,
                    borderRadius: 6,
                    backgroundColor: themeColors.surfaceSecondary
                  }}
                  onPress={() => {
                    setLoopStartMs(null);
                    setLoopEndMs(null);
                    setLoopEnabled(false);
                  }}
                >
                  <Ionicons name="close-circle-outline" size={14} color="#ff7675" />
                </TouchableOpacity>
              )}

              <View style={{ width: 1, height: 16, backgroundColor: themeColors.border }} />

              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: loopEnabled ? 'rgba(46, 204, 113, 0.15)' : themeColors.surfaceSecondary,
                  borderWidth: 1,
                  borderColor: loopEnabled ? '#2ecc71' : themeColors.border
                }}
                disabled={loopStartMs === null || loopEndMs === null}
                onPress={() => setLoopEnabled(prev => !prev)}
              >
                <Ionicons name="repeat" size={12} color={loopEnabled ? '#2ecc71' : themeColors.text} />
                <Text style={{ fontSize: 10, color: loopEnabled ? '#2ecc71' : themeColors.text, fontWeight: 'bold' }}>
                  {loopEnabled ? 'Loop On' : 'Loop Off'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Main Buttons */}
            <View style={styles.buttonsRow}>
              {/* Always show Synthesize button to the left of the stop button */}
              <TouchableOpacity 
                style={[styles.miniProcessBtn, { backgroundColor: themeColors.accent, marginRight: 10, marginLeft: 0 }]}
                onPress={handleProcess}
                disabled={loading || isPreviewPlaying || isPlaying}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="color-wand" size={16} color="#fff" style={{ marginRight: 6 }} />
                    <Text style={styles.miniProcessBtnText}>Synthesize</Text>
                  </>
                )}
              </TouchableOpacity>

              {playbackMode === 'preview' ? (
                // PREVIEW PLAY BUTTONS
                <>
                  <TouchableOpacity 
                    style={[styles.playbackStopBtn, { backgroundColor: themeColors.surfaceSecondary }]}
                    onPress={stopPreview}
                  >
                    <Ionicons name="square" size={24} color={themeColors.text} />
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.playbackPlayBtn, { backgroundColor: '#a29bfe' }]}
                    onPress={handleTogglePreview}
                    disabled={isPreviewLoading}
                  >
                    {isPreviewLoading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Ionicons name={isPreviewPlaying ? "pause" : "play"} size={36} color="#fff" />
                    )}
                  </TouchableOpacity>
                </>
              ) : (
                // PERFORMANCE PLAY BUTTONS
                <>
                  <TouchableOpacity 
                    style={[styles.playbackStopBtn, { backgroundColor: themeColors.surfaceSecondary }]}
                    onPress={stopPlayback}
                  >
                    <Ionicons name="square" size={24} color={themeColors.text} />
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.playbackPlayBtn, { backgroundColor: themeColors.accent }]}
                    onPress={isPlaying ? pausePlayback : startPlayback}
                  >
                    <Ionicons name={isPlaying ? "pause" : "play"} size={36} color="#fff" />
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>

          {/* Floating Markers Tooltip Popup (Top) */}
          {showTooltip && (
            <View style={{
              position: 'absolute',
              top: 50,
              left: 15,
              right: 15,
              backgroundColor: themeColors.surface,
              borderRadius: 12,
              padding: 12,
              borderWidth: 1.5,
              borderColor: themeColors.border,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 5,
              elevation: 10,
              zIndex: 1000,
              flexDirection: 'column',
              gap: 8
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: themeColors.text, fontWeight: 'bold', fontSize: 13 }}>
                  Vocal Marker: {formatTime(tooltipTimeMs)}
                </Text>
                <TouchableOpacity onPress={() => setShowTooltip(false)}>
                  <Ionicons name="close" size={20} color={themeColors.textMuted} />
                </TouchableOpacity>
              </View>
              
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                <TouchableOpacity
                  style={{ backgroundColor: '#e84393', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 }}
                  onPress={() => {
                    setShowTooltip(false);
                    setFinetuneMode('breakline');
                    setFinetuneTimeMs(tooltipTimeMs);
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: 'bold' }}>+ Breakline</Text>
                </TouchableOpacity>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <TouchableOpacity
                    style={{ backgroundColor: '#2ecc71', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 }}
                    onPress={() => {
                      setShowTooltip(false);
                      setFinetuneMode('loopStart');
                      setFinetuneTimeMs(tooltipTimeMs);
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: 'bold' }}>+ Loop A</Text>
                  </TouchableOpacity>
                  {loopStartMs !== null && (
                    <TouchableOpacity 
                      style={{ padding: 4, backgroundColor: themeColors.surfaceSecondary, borderRadius: 6 }}
                      onPress={() => {
                        setLoopStartMs(null);
                        setLoopEnabled(false);
                      }}
                    >
                      <Ionicons name="trash-outline" size={14} color="#ff7675" />
                    </TouchableOpacity>
                  )}
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <TouchableOpacity
                    style={{ backgroundColor: '#e74c3c', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 }}
                    onPress={() => {
                      setShowTooltip(false);
                      setFinetuneMode('loopEnd');
                      setFinetuneTimeMs(tooltipTimeMs);
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: 'bold' }}>+ Loop B</Text>
                  </TouchableOpacity>
                  {loopEndMs !== null && (
                    <TouchableOpacity 
                      style={{ padding: 4, backgroundColor: themeColors.surfaceSecondary, borderRadius: 6 }}
                      onPress={() => {
                        setLoopEndMs(null);
                        setLoopEnabled(false);
                      }}
                    >
                      <Ionicons name="trash-outline" size={14} color="#ff7675" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
          )}

          {/* Floating Finetuning controls (Bottom) */}
          {finetuneMode !== null && (
            <View style={{
              position: 'absolute',
              bottom: 110,
              left: 15,
              right: 15,
              backgroundColor: themeColors.surface,
              borderRadius: 12,
              padding: 12,
              borderWidth: 1.5,
              borderColor: themeColors.border,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.3,
              shadowRadius: 5,
              elevation: 10,
              zIndex: 1000,
              flexDirection: 'column',
              gap: 8,
              alignItems: 'center'
            }}>
              <Text style={{ color: themeColors.text, fontWeight: 'bold', fontSize: 12 }}>
                Finetuning {finetuneMode === 'breakline' ? 'Breakline' : finetuneMode === 'loopStart' ? 'Loop A' : 'Loop B'}: {formatTime(finetuneTimeMs)}
              </Text>
              
              <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center', marginVertical: 4 }}>
                {/* Decrements */}
                {[-50, -10, -1].map(val => (
                  <TouchableOpacity
                    key={`fdec-${val}`}
                    style={{ paddingHorizontal: 8, paddingVertical: 6, backgroundColor: themeColors.surfaceSecondary, borderRadius: 6, borderWidth: 1, borderColor: themeColors.border }}
                    onPress={() => setFinetuneTimeMs(prev => Math.max(0, prev + val))}
                  >
                    <Text style={{ fontSize: 10, color: themeColors.text }}>{val}ms</Text>
                  </TouchableOpacity>
                ))}

                {/* Increments */}
                {[1, 10, 50].map(val => (
                  <TouchableOpacity
                    key={`finc-${val}`}
                    style={{ paddingHorizontal: 8, paddingVertical: 6, backgroundColor: themeColors.surfaceSecondary, borderRadius: 6, borderWidth: 1, borderColor: themeColors.border }}
                    onPress={() => setFinetuneTimeMs(prev => prev + val)}
                  >
                    <Text style={{ fontSize: 10, color: themeColors.text }}>+{val}ms</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                <TouchableOpacity
                  style={{ backgroundColor: themeColors.border, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 }}
                  onPress={() => setFinetuneMode(null)}
                >
                  <Text style={{ color: themeColors.text, fontSize: 12, fontWeight: 'bold' }}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={{ backgroundColor: themeColors.accent, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 }}
                  onPress={() => {
                    const targetTime = finetuneTimeMs;
                    if (finetuneMode === 'breakline') {
                      let initialOffset = importedVocalsDelayMs;
                      const sorted = [...importedVocalsBreaklines].sort((a,b) => a.time_ms - b.time_ms);
                      for (const b of sorted) {
                        if (b.time_ms < targetTime) {
                          initialOffset = b.offset_ms;
                        } else {
                          break;
                        }
                      }
                      
                      const updated = [...importedVocalsBreaklines, { time_ms: targetTime, offset_ms: initialOffset }]
                        .sort((a, b) => a.time_ms - b.time_ms);
                      setImportedVocalsBreaklines(updated);
                    } else if (finetuneMode === 'loopStart') {
                      setLoopStartMs(targetTime);
                    } else if (finetuneMode === 'loopEnd') {
                      setLoopEndMs(targetTime);
                    }
                    setFinetuneMode(null);
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>Accept</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* MP3 Vocal Stem Selection Modal */}
          <Modal
            visible={showMp3ImportModal}
            transparent
            animationType="slide"
            onRequestClose={() => setShowMp3ImportModal(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { backgroundColor: themeColors.surface, maxHeight: '80%' }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                  <Text style={[styles.modalTitle, { color: themeColors.text }]}>Link MP3 Vocals</Text>
                  <TouchableOpacity onPress={() => setShowMp3ImportModal(false)}>
                    <Ionicons name="close" size={24} color={themeColors.text} />
                  </TouchableOpacity>
                </View>

                {mp3Jobs.length === 0 ? (
                  <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                    <Ionicons name="cloud-offline-outline" size={48} color={themeColors.textMuted} />
                    <Text style={{ color: themeColors.textMuted, marginTop: 10, textAlign: 'center' }}>
                      No completed MP3 separation jobs found.
                    </Text>
                  </View>
                ) : (
                  <FlatList
                    data={mp3Jobs}
                    keyExtractor={(item) => item.job_id}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={{
                          padding: 12,
                          borderBottomWidth: 1,
                          borderBottomColor: themeColors.border,
                          backgroundColor: themeColors.surfaceSecondary,
                          borderRadius: 8,
                          marginBottom: 8
                        }}
                        onPress={() => handleSelectMp3Vocals(item.job_id)}
                      >
                        <Text style={{ color: themeColors.text, fontWeight: 'bold', fontSize: 13 }} numberOfLines={1}>
                          {item.original_name || item.filename || 'Untitled MP3 Job'}
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 15, marginTop: 4 }}>
                          <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>
                            ID: {item.job_id.slice(0, 8)}
                          </Text>
                          {item.artist && (
                            <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>
                              Artist: {item.artist}
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    )}
                    style={{ maxHeight: 350 }}
                  />
                )}

                <TouchableOpacity 
                  style={[styles.modalBtn, { backgroundColor: themeColors.accent, marginTop: 15 }]} 
                  onPress={() => setShowMp3ImportModal(false)}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center' }}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

        </View>
      )}

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContainer: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  uploadBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  jobCard: {
    flexDirection: 'row',
    padding: 8,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    alignItems: 'center',
  },
  jobInfo: {
    flex: 1,
  },
  jobFilename: {
    fontSize: 14,
    fontWeight: '500',
  },
  jobMeta: {
    fontSize: 11,
  },
  progressContainer: {
    marginTop: 5,
  },
  progressBarBg: {
    height: 4,
    width: '100%',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressBarFill: {
    height: '100%',
  },
  progressText: {
    fontSize: 11,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 4,
    alignSelf: 'flex-start',
    gap: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  deleteCardBtn: {
    padding: 5,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  emptySubtext: {
    fontSize: 12,
  },

  // CONFIGURATION STAGE STYLES REMOVED (CONSOLIDATED INTO WORKSPACE)

  // VISUALIZER STAGE
  visualizerStage: {
    flex: 1,
  },
  visualizerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
  },
  visualizerFilename: {
    fontSize: 16,
    fontWeight: '700',
  },
  visualizerStateSub: {
    fontSize: 11,
    marginTop: 2,
  },
  delayControls: {
    alignItems: 'flex-end',
  },
  delayLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
  },
  delayButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  offsetBtn: {
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  offsetBtnText: {
    fontSize: 10,
    fontWeight: '700',
  },
  offsetValue: {
    fontSize: 11,
    minWidth: 40,
    textAlign: 'center',
  },

  // Timeline UI Layout
  visualizerContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 170,
    borderRightWidth: 1,
    zIndex: 10,
  },
  sidebarLane: {
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderBottomWidth: 1,
  },
  sidebarLaneTitle: {
    fontSize: 11,
    fontWeight: '700',
  },
  sidebarBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
    gap: 4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderRadius: 3,
    gap: 2,
  },
  badgeText: {
    fontSize: 8,
    fontWeight: '700',
  },
  verticalLanesScrollView: {
    flex: 1,
  },
  lanesScrollView: {
    flex: 1,
  },
  settingsPanel: {
    padding: 15,
    borderBottomWidth: 1,
  },
  settingItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  settingItemLabel: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  presetsGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  presetBadge: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  presetBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  allocationRow: {
    flexDirection: 'row',
    marginTop: 6,
    gap: 6,
  },
  allocToggleBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  miniProcessBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginLeft: 15,
  },
  miniProcessBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  modeIndicatorText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  laneTimeline: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderBottomWidth: 1,
  },
  gridLine: {
    position: 'absolute',
    borderLeftWidth: 1,
    borderStyle: 'dashed',
    opacity: 0.15,
  },
  note: {
    position: 'absolute',
    borderRadius: 1.5,
  },
  playheadLine: {
    position: 'absolute',
    width: 1.5,
    top: 0,
    bottom: 0,
    zIndex: 5,
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 3,
  },

  // Playback Control Bar
  controlsBar: {
    padding: 15,
    paddingBottom: 25,
    borderTopWidth: 1,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  buttonsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 30,
  },
  playbackPlayBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  playbackStopBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  stepValueText: {
    fontSize: 14,
    fontWeight: '700',
    minWidth: 45,
    textAlign: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  statBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  settingsBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  cleanBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  cleanBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  statusTag: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  statusTagText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
  },
  bottomSheetContent: {
    width: '100%',
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    position: 'absolute',
    bottom: 0,
    elevation: 20,
  },
  bottomSheetHeader: {
    paddingBottom: 12,
    borderBottomWidth: 1,
    marginBottom: 12,
  },
  bottomSheetTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  bottomSheetSub: {
    fontSize: 12,
    marginTop: 2,
  },
  bottomSheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    gap: 12,
  },
  bottomSheetItemText: {
    fontSize: 15,
    fontWeight: '600',
  },
  bottomSheetCancel: {
    width: '100%',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 15,
  },
  bottomSheetCancelText: {
    fontWeight: '600',
    fontSize: 15,
  },
  inputContainer: {
    marginBottom: 12,
    width: '100%',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  aiInfoBlock: {
    padding: 10,
    borderRadius: 8,
    marginVertical: 8,
    width: '100%',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    width: '100%',
  },
  modalBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  presetBadgesRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
  },
  sliderContainer: {
    width: '100%',
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  metaField: {
    marginBottom: 12,
    width: '100%',
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  metaInput: {
    fontSize: 15,
    borderBottomWidth: 1,
    paddingVertical: 4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginTop: 20,
  },
  modalBtnFlex: {
    flex: 1,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 80,
  },
  actionBar: { 
    flexDirection: 'row', 
    padding: 10, 
    alignItems: 'center', 
    position: 'absolute', 
    top: 0, 
    left: 0, 
    right: 0, 
    zIndex: 100, 
    elevation: 10, 
    height: 75, 
    paddingTop: Platform.OS === 'ios' ? 30 : 10 
  },
  actionCount: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 15, 
    borderRightWidth: 1, 
    borderRightColor: 'rgba(255,255,255,0.2)' 
  },
  actionCountText: { 
    color: '#fff', 
    fontWeight: '700', 
    marginLeft: 5 
  },
  actionButtons: { 
    paddingHorizontal: 10, 
    gap: 20, 
    alignItems: 'center',
    flexDirection: 'row'
  },
  barBtn: { 
    alignItems: 'center', 
    minWidth: 50 
  },
  barBtnText: { 
    fontSize: 10, 
    color: '#fff', 
    fontWeight: '600', 
    marginTop: 2 
  },
  selectionIndicator: { 
    marginRight: 12 
  },
  searchBar: { 
    padding: 10, 
    borderRadius: 8, 
    fontSize: 16, 
    marginBottom: 10 
  },
  sortBar: { 
    flexDirection: 'row', 
    alignItems: 'center' 
  },
  sortBtn: { 
    paddingHorizontal: 10, 
    paddingVertical: 5, 
    borderRadius: 15, 
    marginRight: 5 
  },
  sortBtnText: { 
    fontSize: 12 
  }
});
