export function normalizeArchiveSampleExtensions(values: string[]) {
  return [...new Set(values.map(normalizeArchiveSampleExtension).filter((value) => value.length > 0))];
}

export function parseArchiveSampleExtensionsInput(input: string) {
  return normalizeArchiveSampleExtensions(input.split(","));
}

export function validateArchiveSampleExtensionsInput(input: string) {
  const fileExtensions = input
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  if (fileExtensions.length === 0) {
    return {
      canSave: false,
      error: null,
      fileExtensions,
    };
  }

  const seenExtensions = new Set<string>();
  for (const fileExtension of fileExtensions) {
    if (!fileExtension.startsWith(".") || fileExtension === ".") {
      return {
        canSave: false,
        error: "Each file extension must start with a .",
        fileExtensions,
      };
    }
    if (seenExtensions.has(fileExtension)) {
      return {
        canSave: false,
        error: "Duplicate file extensions are not allowed.",
        fileExtensions,
      };
    }
    seenExtensions.add(fileExtension);
  }

  return {
    canSave: true,
    error: null,
    fileExtensions,
  };
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
