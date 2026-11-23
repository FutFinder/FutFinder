module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    // `lucidePorIcono` importa cada ícono desde su archivo en vez de desde
    // la raíz de Lucide, que arrastra los ~1.500 (1,2 MB del bundle web).
    //
    // Requerido por react-native-reanimated v4 (peer dep de nativewind vía
    // react-native-css-interop). Debe ir último en la lista de plugins.
    plugins: [require('./scripts/babel/lucidePorIcono'), 'react-native-worklets/plugin'],
  };
};
