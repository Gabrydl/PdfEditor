// Sets the icon and the file properties of the Windows exe (no Windows needed).
const fs = require("fs");
const PELibrary = require("pe-library");
const ResEdit = require("resedit");
const [exePath, icoPath, name, version, desc] = process.argv.slice(2);
const exe = PELibrary.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = PELibrary.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const id = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, ico.icons.map(i => i.data));
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
const v = (version + ".0.0.0").split(".").slice(0, 4).map(Number);
vi.setFileVersion(v[0], v[1], v[2], v[3], 1033);
vi.setProductVersion(v[0], v[1], v[2], v[3], 1033);
vi.setStringValues({ lang: 1033, codepage: 1200 }, { ProductName: name, FileDescription: name, CompanyName: "gabrydl99", LegalCopyright: "",
  OriginalFilename: name + ".exe", InternalName: name, FileVersion: version, ProductVersion: version, Comments: desc || "" });
vi.outputToResourceEntries(res.entries);
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log("exe info set:", name, version);
