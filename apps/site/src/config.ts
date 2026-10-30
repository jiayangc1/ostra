/** Build-time settings for ostramail.com. Download links appear only once builds are published. */
export const SITE = {
  appUrl: import.meta.env.PUBLIC_APP_URL || "https://app.ostramail.com",
  apiUrl: import.meta.env.PUBLIC_API_URL || "https://app.ostramail.com",
  downloads: {
    mac: import.meta.env.PUBLIC_DOWNLOAD_MAC as string | undefined,
    windows: import.meta.env.PUBLIC_DOWNLOAD_WINDOWS as string | undefined,
    linux: import.meta.env.PUBLIC_DOWNLOAD_LINUX as string | undefined,
  },
};
