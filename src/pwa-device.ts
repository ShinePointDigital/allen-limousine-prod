type DeviceSignals = {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentDataMobile?: boolean;
};

export function isPwaPhoneDevice({ userAgent, platform, maxTouchPoints, userAgentDataMobile }: DeviceSignals) {
  const agent = userAgent.toLowerCase();
  const iPadOS = /ipad/.test(agent) || (platform === "MacIntel" && (maxTouchPoints || 0) > 1);
  const tablet = /tablet|playbook|silk/.test(agent);
  if (iPadOS || tablet || userAgentDataMobile === false) return false;

  if (/iphone|ipod|windows phone|iemobile/.test(agent)) return true;
  if (/\bandroid\b/.test(agent)) return userAgentDataMobile === true || /\bmobile\b/.test(agent);
  return false;
}

export function isPwaPhone() {
  const browserNavigator = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return isPwaPhoneDevice({
    userAgent: browserNavigator.userAgent,
    platform: browserNavigator.platform,
    maxTouchPoints: browserNavigator.maxTouchPoints,
    userAgentDataMobile: browserNavigator.userAgentData?.mobile,
  });
}