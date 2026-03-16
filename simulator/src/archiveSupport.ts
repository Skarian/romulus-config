const SUPPORTED_ARCHIVE_EXTENSIONS = [".zip", ".rar", ".7z"] as const;

export function isSupportedArchiveName(pathValue: string) {
  const lowerName = pathValue.toLowerCase();
  return SUPPORTED_ARCHIVE_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

export function archiveBaseName(name: string) {
  const lowerName = name.toLowerCase();
  const matched = SUPPORTED_ARCHIVE_EXTENSIONS.find((extension) => lowerName.endsWith(extension));
  return matched ? name.slice(0, -matched.length) : name;
}
