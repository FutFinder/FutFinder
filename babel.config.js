module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    // Requerido por react-native-reanimated v4 (peer dep de nativewind vía
    // react-native-css-interop). Debe ir último en la lista de plugins.
    plugins: ['react-native-worklets/plugin'],
  };
};
