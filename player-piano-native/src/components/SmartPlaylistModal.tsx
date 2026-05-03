import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, Switch, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Colors';
import { useStore } from '../store/useStore';

interface SmartPlaylistModalProps {
  visible: boolean;
  initialData?: {
    name: string;
    filterType: 'artist' | 'genre' | 'mood' | 'source' | 'rating' | 'all';
    filterValue: string;
    excludeDnu: boolean;
  };
  onClose: () => void;
  onGenerate: (name: string, type: string, value: string, excludeDnu: boolean) => Promise<void>;
  themeColors: any;
}

export const SmartPlaylistModal = React.memo(({ visible, initialData, onClose, onGenerate, themeColors }: SmartPlaylistModalProps) => {
  const uniqueMetadata = useStore(state => state.uniqueMetadata);
  const [name, setName] = useState('');
  const [filterType, setFilterType] = useState<'artist' | 'genre' | 'mood' | 'source' | 'rating' | 'all'>('artist');
  const [filterValue, setFilterValue] = useState('');
  const [excludeDnu, setExcludeDnu] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(initialData?.name || '');
      setFilterType(initialData?.filterType || 'artist');
      setFilterValue(initialData?.filterValue || '');
      setExcludeDnu(initialData?.excludeDnu !== undefined ? initialData.excludeDnu : true);
    }
  }, [visible, initialData]);

  const handleGenerate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await onGenerate(name.trim(), filterType, filterValue, excludeDnu);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: themeColors.surface }]}>
          <Text style={[styles.modalTitle, { color: themeColors.text }]}>Smart Playlist Builder</Text>
          
          <Text style={[styles.label, { color: themeColors.textMuted, marginBottom: 8 }]}>Playlist Name</Text>
          <TextInput
            style={[styles.modalInput, { borderColor: themeColors.border, backgroundColor: themeColors.background, color: themeColors.text, marginBottom: 15 }]}
            value={name}
            onChangeText={setName}
            placeholder="e.g. My Favorites"
            placeholderTextColor={themeColors.textMuted}
          />

          <Text style={[styles.label, { color: themeColors.textMuted, marginBottom: 8 }]}>Filter By</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 15 }}>
            {['artist', 'genre', 'mood', 'source', 'rating', 'all'].map((type) => (
              <TouchableOpacity 
                key={type} 
                onPress={() => setFilterType(type as any)}
                style={[
                  styles.filterChip, 
                  { backgroundColor: filterType === type ? themeColors.accent : themeColors.surfaceSecondary }
                ]}
              >
                <Text style={{ color: filterType === type ? '#fff' : themeColors.text, fontSize: 12, fontWeight: '600' }}>
                  {type.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {filterType !== 'all' && (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={[styles.label, { color: themeColors.textMuted }]}>
                  {filterType === 'rating' ? 'Minimum Rating (1-5)' : 'Containing Text'}
                </Text>
                {filterType !== 'rating' && (
                  <Text style={{ fontSize: 10, color: themeColors.textMuted }}>Comma-separated (OR)</Text>
                )}
              </View>

              <TextInput
                style={[styles.modalInput, { borderColor: themeColors.border, backgroundColor: themeColors.background, color: themeColors.text, marginBottom: 10 }]}
                value={filterValue}
                onChangeText={setFilterValue}
                placeholder={filterType === 'rating' ? "e.g. 4" : "e.g. Final Fantasy, Chrono Trigger"}
                placeholderTextColor={themeColors.textMuted}
                keyboardType={filterType === 'rating' ? 'numeric' : 'default'}
                autoFocus
              />

              {filterType !== 'rating' && uniqueMetadata[filterType] && uniqueMetadata[filterType].length > 0 && (
                <ScrollView 
                  horizontal 
                  showsHorizontalScrollIndicator={false} 
                  contentContainerStyle={{ gap: 8, paddingBottom: 15 }}
                >
                  {uniqueMetadata[filterType].map(val => (
                    <TouchableOpacity 
                      key={val}
                      style={[styles.suggestionChip, { backgroundColor: themeColors.surfaceSecondary }]}
                      onPress={() => {
                        const currentParts = filterValue.split(',').map(s => s.trim()).filter(Boolean);
                        if (!currentParts.includes(val)) {
                          currentParts.push(val);
                          setFilterValue(currentParts.join(', '));
                        }
                      }}
                    >
                      <Text style={{ color: themeColors.text, fontSize: 12 }}>{val}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </>
          )}

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
            <View>
              <Text style={{ color: themeColors.text, fontWeight: '600' }}>Exclude DNU</Text>
              <Text style={{ color: themeColors.textMuted, fontSize: 11 }}>Don't include songs marked 'Do Not Use'</Text>
            </View>
            <Switch 
              value={excludeDnu} 
              onValueChange={setExcludeDnu}
              trackColor={{ false: themeColors.border, true: '#ff5252' }}
            />
          </View>

          <View style={[styles.modalButtons, { marginTop: 10 }]}>
            <TouchableOpacity 
              style={[styles.modalBtn, { backgroundColor: themeColors.surfaceSecondary }]} 
              onPress={onClose}
              disabled={loading}
            >
              <Text style={{ color: themeColors.text }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.modalBtn, { backgroundColor: themeColors.accent }]} 
              onPress={handleGenerate}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={{color: '#fff', fontWeight: '700'}}>Generate</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', borderRadius: 12, padding: 25 },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 15 },
  modalInput: { borderWidth: 1, borderRadius: 8, padding: 15, fontSize: 18, textAlign: 'center' },
  modalButtons: { flexDirection: 'row', gap: 10 },
  modalBtn: { flex: 1, padding: 15, borderRadius: 8, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  suggestionChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  label: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }
});
