jest.mock('expo-blur', () => ({
  BlurView: ({ children }) => children,
}));

jest.mock('expo-av', () => ({
  Audio: {
    Sound: {
      createAsync: jest.fn().mockResolvedValue({
        sound: {
          playAsync: jest.fn().mockResolvedValue(undefined),
          unloadAsync: jest.fn().mockResolvedValue(undefined),
          setOnPlaybackStatusUpdate: jest.fn(),
        },
      }),
    },
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    InterruptionModeAndroid: { DuckOthers: 1 },
  },
}));

// Silence RN warnings in tests
jest.spyOn(global.console, 'warn').mockImplementation(() => {});
jest.spyOn(global.console, 'error').mockImplementation(() => {});


