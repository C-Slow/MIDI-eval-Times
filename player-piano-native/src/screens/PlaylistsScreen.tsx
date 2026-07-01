import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, RefreshControl, ScrollView, Platform, Modal, TextInput, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import { playlistApi, pianoApi } from '../services/api';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { Colors } from '../constants/Colors';
import { SmartPlaylistModal } from '../components/SmartPlaylistModal';

const TrackListItem = React.memo(({ track, index, isSelected, themeColors, onPlay, onSelect, getDisplayName, artist }: any) => (
  <TouchableOpacity 
    style={[styles.trackItem, isSelected && { backgroundColor: themeColors.accentLight }, { borderBottomColor: themeColors.border, minHeight: 50, paddingVertical: 10 }]} 
    onPress={onPlay}
    onLongPress={onSelect}
  >
    <View style={styles.selectionIndicator}>
      <Ionicons 
        name={isSelected ? "checkmark-circle" : "ellipse-outline"} 
        size={22} 
        color={isSelected ? themeColors.accent : themeColors.textMuted} 
      />
    </View>
    <View style={styles.trackInfo}>
      <Text style={[styles.trackNumber, { color: themeColors.textMuted }]}>{index + 1}.</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.trackName, { color: themeColors.text }]} numberOfLines={1}>{getDisplayName(track)}</Text>
        {artist ? (
          <Text style={{ fontSize: 10, color: themeColors.accent, fontWeight: '600', marginTop: -2 }} numberOfLines={1}>
            {artist}
          </Text>
        ) : null}
      </View>
    </View>
  </TouchableOpacity>
));

export const PlaylistsScreen = () => {
  const playlists = useStore(state => state.playlists);
  const setPlaylists = useStore(state => state.setPlaylists);
  const files = useStore(state => state.files); // Needed for metadata
  const theme = useStore(state => state.theme);
  const isPianoConnected = useStore(state => state.isPianoConnected);
  const themeColors = Colors[theme];
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { play } = useAudioPlayer();

  const [selectedTracks, setSelectedFiles] = useState<Set<string>>(new Set());
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [smartRules, setSmartRules] = useState<any>({});

  const [smartModal, setSmartModal] = useState<{ 
    visible: boolean, 
    name: string, 
    filterType: 'artist' | 'genre' | 'mood' | 'source' | 'rating' | 'all',
    filterValue: string,
    excludeDnu: boolean,
    filters?: Array<{ filter_type: string, filter_value: string }>
  }>({
    visible: false,
    name: '',
    filterType: 'artist',
    filterValue: '',
    excludeDnu: true,
    filters: []
  });

  const fetchPlaylists = async () => {
    try {
      const data = await playlistApi.listPlaylists();
      setPlaylists(data);
      const rules = await playlistApi.getPlaylistRules();
      setSmartRules(rules);
    } catch (error) {
      console.error(error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchPlaylists();
    setRefreshing(false);
  };

  useEffect(() => {
    setLoading(true);
    fetchPlaylists().finally(() => setLoading(false));
  }, []);

  const toggleSelect = React.useCallback((filename: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }, []);

  const clearSelection = () => setSelectedFiles(new Set());

  const fileMetadataMap = useMemo(() => {
    const map: Record<string, any> = {};
    [...files.processed, ...files.raw].forEach(f => {
      map[f.name] = f.metadata;
    });
    return map;
  }, [files]);

  const flattenedData = useMemo(() => {
    const result: any[] = [];
    const sortedPlaylistNames = Object.keys(playlists).sort((a, b) => a.localeCompare(b));
    sortedPlaylistNames.forEach(name => {
      const t = playlists[name] || [];
      const tracks = Array.isArray(t) ? [...t].sort((a, b) => a.localeCompare(b)) : [];
      result.push({ type: 'header', name, count: tracks.length });
      if (expanded === name) {
        tracks.forEach((track, index) => {
          result.push({ type: 'track', playlistName: name, track, index });
        });
      }
    });
    return result;
  }, [playlists, expanded]);

  const getDisplayName = (filename: string) => {
    return filename.replace(/\.midi?$/i, '');
  };

  const handleBulkRemove = (playlistName: string) => {
    if (selectedTracks.size === 0) return;
    Alert.alert(
      'Remove Tracks',
      `Remove ${selectedTracks.size} tracks from "${playlistName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Remove', 
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await playlistApi.removeBulk(playlistName, Array.from(selectedTracks));
              clearSelection();
              await fetchPlaylists();
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  const handleDeletePlaylist = (name: string) => {
    Alert.alert(
      'Delete Playlist',
      `Permanently delete "${name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            try {
              await playlistApi.deletePlaylist(name);
              await fetchPlaylists();
            } catch (e) {
              Alert.alert('Error', 'Failed to delete playlist');
            }
          }
        }
      ]
    );
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) return;
    try {
      setLoading(true);
      await playlistApi.createPlaylist(newPlaylistName.trim());
      setNewPlaylistName('');
      setCreateModalVisible(false);
      await fetchPlaylists();
    } catch (e) {
      Alert.alert('Error', 'Playlist already exists or failed to create');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSmartPlaylist = async (
    customName?: string, 
    customType?: string, 
    customValue?: string, 
    customExcludeDnu?: boolean,
    customFilters?: Array<{ filter_type: string, filter_value: string }>
  ) => {
    const name = customName || smartModal.name.trim();
    const type = customType !== undefined ? customType : (customFilters ? null : smartModal.filterType);
    const value = customValue !== undefined ? customValue : (customFilters ? null : smartModal.filterValue);
    const exclude = customExcludeDnu !== undefined ? customExcludeDnu : smartModal.excludeDnu;
    const filters = customFilters || smartModal.filters;

    if (!name) return;
    try {
      setLoading(true);
      const res = await playlistApi.createSmartPlaylist(name, type, value, exclude, filters);
      setSmartModal({ ...smartModal, visible: false, name: '', filterValue: '', filters: [] });
      await fetchPlaylists();
      if (!customName) {
        Alert.alert('Success', `Created "${res.created}" with ${res.count} tracks.`);
      }
    } catch (e: any) {
      const errorDetail = e.response?.data?.detail;
      const errorMessage = typeof errorDetail === 'string'
        ? errorDetail
        : (Array.isArray(errorDetail)
            ? errorDetail.map((err: any) => err.msg || JSON.stringify(err)).join('\n')
            : (errorDetail ? JSON.stringify(errorDetail) : 'Failed to create smart playlist'));
      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshSmart = (name: string) => {
    const rule = smartRules[name];
    if (!rule) return;
    const filters = rule.filters || [{ filter_type: rule.filter_type, filter_value: rule.filter_value }];
    handleCreateSmartPlaylist(name, undefined, undefined, rule.exclude_dnu, filters);
  };

  const handleEditSmart = (name: string) => {
    const rule = smartRules[name];
    if (!rule) return;
    setSmartModal({
      visible: true,
      name: name,
      filterType: rule.filter_type || 'artist',
      filterValue: rule.filter_value || '',
      excludeDnu: rule.exclude_dnu !== undefined ? rule.exclude_dnu : true,
      filters: rule.filters || (rule.filter_type ? [{ filter_type: rule.filter_type, filter_value: rule.filter_value }] : [])
    });
  };

  const handleRefreshAllSmart = async () => {
    setLoading(true);
    try {
      const res = await playlistApi.refreshAllSmartPlaylists();
      await fetchPlaylists();
      Alert.alert('Success', `Refreshed ${res.refreshed} smart playlists.`);
    } catch (e) {
      Alert.alert('Error', 'Failed to refresh all playlists');
    } finally {
      setLoading(false);
    }
  };

  const [repeat, setRepeat] = useState(false);

  const handlePlayPlaylist = async (name: string, shuffle = false) => {
    if (!isPianoConnected) {
      Alert.alert('Not Connected', 'Connect to the piano in Settings first.');
      return;
    }
    try {
      await playlistApi.playPlaylist(name, { shuffle, repeat });
      Alert.alert('Success', `Playing: ${name}`);
    } catch (error) {
      Alert.alert('Error', 'Failed to start playback');
    }
  };

  const getPlaylistColor = (name: string) => {
    const colors = [
      '#4CAF50', '#2196F3', '#9C27B0', '#FF9800', '#E91E63', 
      '#00BCD4', '#009688', '#FF5722', '#673AB7', '#3F51B5'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const renderItem = React.useCallback(({ item }: { item: any }) => {
    if (item.type === 'header') {
      const name = item.name;
      const isExpanded = expanded === name;
      const isSmart = !!smartRules[name];
      const count = item.count;

      return (
        <View style={[styles.playlistContainer, { borderBottomColor: themeColors.border }]}>
          <View style={[styles.playlistHeaderRow, { backgroundColor: themeColors.background, paddingVertical: 10, paddingHorizontal: 10, gap: 8, alignItems: 'center' }]}>
            {/* Color Tab */}
            <View style={{ width: 6, backgroundColor: getPlaylistColor(name), borderRadius: 3, alignSelf: 'stretch' }} />
            
            {isSmart && (
              <TouchableOpacity 
                style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: themeColors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' }} 
                onPress={() => handleRefreshSmart(name)}
              >
                <Ionicons name="refresh-outline" size={18} color={themeColors.accent} />
              </TouchableOpacity>
            )}

            <TouchableOpacity 
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }} 
              onPress={() => {
                setExpanded(isExpanded ? null : name);
                clearSelection();
              }}
              onLongPress={() => isSmart && handleEditSmart(name)}
            >
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={[styles.playlistName, { color: themeColors.text, fontSize: 16 }]} numberOfLines={1}>
                    {name}
                  </Text>
                  {isSmart && <Ionicons name="sparkles" size={12} color={themeColors.accent} />}
                </View>
                <Text style={[styles.trackCount, { color: themeColors.textMuted, fontSize: 11, marginTop: 2 }]}>
                  {count} tracks
                </Text>
              </View>
              <Ionicons name={isExpanded ? "chevron-down" : "chevron-forward"} size={18} color={themeColors.accent} />
            </TouchableOpacity>
            
            {/* Action Buttons: Play, Shuffle, Delete */}
            <TouchableOpacity 
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: themeColors.accent, alignItems: 'center', justifyContent: 'center' }} 
              onPress={() => handlePlayPlaylist(name)}
            >
              <Ionicons name="play" size={18} color="#fff" />
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: themeColors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' }} 
              onPress={() => handlePlayPlaylist(name, true)}
            >
              <Ionicons name="shuffle" size={18} color={themeColors.text} />
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: themeColors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' }} 
              onPress={() => handleDeletePlaylist(name)}
            >
              <Ionicons name="trash-outline" size={18} color={themeColors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    // type === 'track'
    const { track, playlistName, index } = item;
    const found = [...files.processed, ...files.raw].find(f => f.name === track);
    const artist = found?.metadata?.artist;

    return (
      <View style={{ backgroundColor: themeColors.surface, paddingLeft: 16 }}>
        <TrackListItem 
          track={track}
          index={index}
          isSelected={selectedTracks.has(track)}
          themeColors={themeColors}
          onPlay={() => selectedTracks.size > 0 ? toggleSelect(track) : play(track)}
          onSelect={() => toggleSelect(track)}
          getDisplayName={getDisplayName}
          artist={artist}
        />
      </View>
    );
  }, [expanded, smartRules, themeColors, files, selectedTracks, play, toggleSelect, getDisplayName]);

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      {/* Create Playlist Modal */}
      <Modal visible={createModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: themeColors.surface }]}>
            <Text style={[styles.modalTitle, { color: themeColors.text }]}>New Playlist</Text>
            <TextInput
              style={[styles.modalInput, { borderColor: themeColors.border, backgroundColor: themeColors.background, color: themeColors.text }]}
              value={newPlaylistName}
              onChangeText={setNewPlaylistName}
              placeholder="Enter name..."
              placeholderTextColor={themeColors.textMuted}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: themeColors.surfaceSecondary }]} onPress={() => setCreateModalVisible(false)}>
                <Text style={{ color: themeColors.text }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: themeColors.accent }]} onPress={handleCreatePlaylist}>
                <Text style={{color: '#fff', fontWeight: '700'}}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <SmartPlaylistModal
        visible={smartModal.visible}
        initialData={{
          name: smartModal.name,
          filterType: smartModal.filterType,
          filterValue: smartModal.filterValue,
          excludeDnu: smartModal.excludeDnu,
          filters: smartModal.filters
        }}
        onClose={() => setSmartModal(p => ({ ...p, visible: false }))}
        onGenerate={handleCreateSmartPlaylist}
        themeColors={themeColors}
      />

      {/* Sticky Action Bar for Playlists */}
      {selectedTracks.size > 0 && expanded && (
        <View style={[styles.actionBar, { backgroundColor: themeColors.accent }]}>
          <TouchableOpacity style={styles.actionCount} onPress={clearSelection}>
            <Ionicons name="close-circle" size={24} color="#fff" />
            <Text style={styles.actionCountText}>{selectedTracks.size}</Text>
          </TouchableOpacity>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionButtons}>
            <TouchableOpacity style={styles.barBtn} onPress={() => handleBulkRemove(expanded)}>
              <Ionicons name="trash-outline" size={20} color={theme === 'dark' ? '#ff5252' : '#ff1744'} />
              <Text style={[styles.barBtnText, { color: theme === 'dark' ? '#ff5252' : '#ff1744' }]}>Remove</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {loading && !refreshing ? (
        <ActivityIndicator size="large" color={themeColors.accent} style={{ marginTop: 50 }} />
      ) : (
        <FlatList
          data={flattenedData}
          keyExtractor={(item, index) => item.type === 'header' ? `header-${item.name}` : `track-${item.playlistName}-${item.track}-${index}`}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={themeColors.accent} />}
          ListHeaderComponent={
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 15, alignItems: 'center' }}>
              {Object.values(smartRules).length > 0 && (
                <TouchableOpacity 
                  style={[styles.refreshAllBtn, { borderColor: themeColors.accent, flex: 1, marginBottom: 0 }]} 
                  onPress={handleRefreshAllSmart}
                >
                  <Ionicons name="sparkles-outline" size={16} color={themeColors.accent} />
                  <Text style={[styles.refreshAllText, { color: themeColors.accent }]}>Refresh Smart</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity 
                style={[
                  { 
                    borderColor: repeat ? themeColors.accent : themeColors.border, 
                    borderWidth: 1,
                    backgroundColor: repeat ? themeColors.accentLight : themeColors.surfaceSecondary,
                    paddingHorizontal: 15,
                    paddingVertical: 10,
                    borderRadius: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    minHeight: 44
                  },
                  !Object.values(smartRules).length && { flex: 1 }
                ]} 
                onPress={() => setRepeat(!repeat)}
              >
                <Ionicons name="repeat-outline" size={18} color={repeat ? themeColors.accent : themeColors.text} />
                <Text style={{ color: repeat ? themeColors.accent : themeColors.text, fontWeight: '600', fontSize: 13 }}>
                  Repeat: {repeat ? "ON" : "OFF"}
                </Text>
              </TouchableOpacity>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 100, paddingHorizontal: 15, paddingTop: 10 }}
          removeClippedSubviews={true}
          maxToRenderPerBatch={5}
          windowSize={5}
          initialNumToRender={10}
          ListEmptyComponent={
            <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>No playlists found.</Text>
          }
        />
      )}

      <View style={styles.fabContainer}>
        <TouchableOpacity 
          style={[styles.fabSmall, { backgroundColor: themeColors.surfaceSecondary, marginBottom: 10 }]} 
          onPress={() => setSmartModal(p => ({ ...p, visible: true }))}
        >
          <Ionicons name="sparkles" size={20} color={themeColors.accent} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.fab, { backgroundColor: themeColors.accent }]} onPress={() => setCreateModalVisible(true)}>
          <Ionicons name="add" size={30} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  playlistContainer: { borderBottomWidth: 1 },
  playlistHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  headerMain: { 
    flex: 1,
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    padding: 20, 
    alignItems: 'center'
  },
  headerDelete: { padding: 20, borderLeftWidth: 1, borderLeftColor: 'rgba(0,0,0,0.05)' },
  headerLeft: { flex: 1 },
  playlistName: { fontSize: 18, fontWeight: '600' },
  trackCount: { fontSize: 12, marginTop: 4 },
  
  expandedContent: { paddingBottom: 10 },
  controls: { 
    flexDirection: 'row', 
    padding: 15, 
    gap: 10,
    borderBottomWidth: 1
  },
  btnContent: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  playBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 },
  playBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  shuffleBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 },
  shuffleBtnText: { fontWeight: '600', fontSize: 13 },
  repeatBtnActive: { backgroundColor: '#e3f2fd', borderWidth: 1, borderColor: '#0066cc' },
  repeatBtnTextActive: { color: '#0066cc' },
  
  trackItem: { 
    flexDirection: 'row', 
    paddingVertical: 8, 
    paddingHorizontal: 20,
    alignItems: 'center',
    borderBottomWidth: 1
  },
  selectionIndicator: { marginRight: 15 },
  
  trackInfo: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  trackNumber: { fontSize: 12, width: 25 },
  trackName: { fontSize: 14 },
  
  emptyText: { textAlign: 'center', marginTop: 50, paddingHorizontal: 40 },

  actionBar: { 
    flexDirection: 'row', padding: 10, alignItems: 'center',
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100, elevation: 10, height: 75,
    paddingTop: Platform.OS === 'ios' ? 30 : 10
  },
  actionCount: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.2)' },
  actionCountText: { color: '#fff', fontWeight: '700', marginLeft: 5 },
  actionButtons: { paddingHorizontal: 10, gap: 20, alignItems: 'center' },
  barBtn: { alignItems: 'center', minWidth: 50 },
  barBtnText: { fontSize: 10, color: '#fff', fontWeight: '600', marginTop: 2 },

  fabContainer: {
    position: 'absolute',
    right: 20,
    bottom: 100, // Fixed position to clear settings/voice
    alignItems: 'center'
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 4
  },
  fabSmall: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 2
  },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', borderRadius: 12, padding: 25 },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 15 },
  modalInput: { borderWidth: 1, borderRadius: 8, padding: 15, fontSize: 18, textAlign: 'center', marginBottom: 20 },
  modalButtons: { flexDirection: 'row', gap: 10 },
  modalBtn: { flex: 1, padding: 15, borderRadius: 8, alignItems: 'center' },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  label: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  refreshAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 15,
    gap: 8
  },
  refreshAllText: {
    fontWeight: '700',
    fontSize: 14
  }
});
