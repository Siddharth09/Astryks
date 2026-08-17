// Also missing from the delivered app — without this, Metro has no JSX/TypeScript transform
// configured at all (this is the standard, required config for every Expo Router project;
// `babel-preset-expo` is already a devDependency in package.json, just never wired up).
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
  };
};
