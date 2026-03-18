export function normalizeArchiveSampleExtensions(values: string[]) {
  return [...new Set(values.map(normalizeArchiveSampleExtension).filter((value) => value.length > 0))];
}

export function parseArchiveSampleExtensionsInput(input: string) {
  return normalizeArchiveSampleExtensions(input.split(","));
}

export function formatArchiveSampleExtensions(extensions: string[]) {
  return normalizeArchiveSampleExtensions(extensions).join(", ");
}

function normalizeArchiveSampleExtension(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return "";
  }

  if (trimmed === ".") {
    return "";
  }

  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}
