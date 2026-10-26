import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

// Prettier checks these files in the release workflow, before the build.
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 4) + "\n");

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeJson("manifest.json", manifest);

// versions.json maps each plugin version to the app version it needs, so every
// released version needs its own entry, even one that does not change
// minAppVersion.
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
if (!(targetVersion in versions)) {
    versions[targetVersion] = minAppVersion;
    writeJson("versions.json", versions);
}
