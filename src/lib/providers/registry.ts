import { SocialPlatform } from "@prisma/client";
import {
  SocialCommerceProvider,
  CapabilityKey,
  CapabilityStatus,
  DetailedCapability,
} from "./types";
import { InstagramProvider } from "./instagram";
import { WhatsAppProvider } from "./whatsapp";
import { FacebookProvider } from "./facebook";
import { XProvider } from "./x";
import { ManualProvider } from "./manual";

const providers: Map<SocialPlatform, SocialCommerceProvider> = new Map();

// Initialize singleton providers
providers.set(SocialPlatform.INSTAGRAM, new InstagramProvider());
providers.set(SocialPlatform.WHATSAPP, new WhatsAppProvider());
providers.set(SocialPlatform.FACEBOOK, new FacebookProvider());
providers.set(SocialPlatform.X, new XProvider());
providers.set(SocialPlatform.MANUAL, new ManualProvider());
providers.set(SocialPlatform.OTHER, new ManualProvider());
providers.set(SocialPlatform.TIKTOK, new ManualProvider());
providers.set(SocialPlatform.TELEGRAM, new ManualProvider());

export function getSocialProvider(platform: SocialPlatform): SocialCommerceProvider {
  return providers.get(platform) || providers.get(SocialPlatform.MANUAL)!;
}

export function getAllSocialProviders(): SocialCommerceProvider[] {
  return [
    providers.get(SocialPlatform.INSTAGRAM)!,
    providers.get(SocialPlatform.WHATSAPP)!,
    providers.get(SocialPlatform.FACEBOOK)!,
    providers.get(SocialPlatform.X)!,
    providers.get(SocialPlatform.MANUAL)!,
  ];
}

/**
 * Returns discovery data for all platform capabilities
 */
export function getPlatformsCapabilityMatrix(): Record<
  SocialPlatform,
  Record<CapabilityKey, DetailedCapability>
> {
  const result: Partial<
    Record<SocialPlatform, Record<CapabilityKey, DetailedCapability>>
  > = {};

  const platforms: SocialPlatform[] = [
    SocialPlatform.INSTAGRAM,
    SocialPlatform.WHATSAPP,
    SocialPlatform.FACEBOOK,
    SocialPlatform.X,
    SocialPlatform.MANUAL,
  ];

  for (const plat of platforms) {
    const prov = getSocialProvider(plat);
    result[plat] = prov.getDetailedCapabilities();
  }

  return result as Record<
    SocialPlatform,
    Record<CapabilityKey, DetailedCapability>
  >;
}
