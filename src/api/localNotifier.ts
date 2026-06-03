import type { ListingResult } from "../types/trade";

export async function showTopmostAlert(listing: ListingResult, cookie: string) {
  const token = listing.listing.whisper_token || listing.listing.hideout_token || "";
  const itemName = listing.item.name || listing.item.typeLine;
  const price = listing.listing.price;
  const seller = listing.listing.account.lastCharacterName || listing.listing.account.name;

  try {
    await fetch("/local/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "POE2 Sniper Alert",
        body: `${itemName} at ${price.amount} ${price.currency}\nSeller: ${seller}`,
        token,
        cookie,
      }),
    });
  } catch {
    // Dev server has no local launcher endpoint; browser toast still covers that path.
  }
}
