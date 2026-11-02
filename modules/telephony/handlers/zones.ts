// The recipient's time zone, read from their number (spec 2.18). A contact holds no zone in v1 data, and a text's quiet hours are the recipient's own, so the number decides: the US and Canada by area code,
// other countries where one zone covers them. Null means the number does not say, and the caller falls back on the sender's zone. A US state split across two zones reads as the zone most of its numbers are in.

const LA = "206 209 213 236 250 253 279 310 323 341 350 360 408 415 424 425 442 458 503 509 510 530 541 559 562 564 604 619 626 628 650 657 661 669 672 702 707 714 725 747 760 775 778 805 818 820 831 840 858 909 916 925 949 951 971";
const DENVER = "208 303 307 385 403 406 435 505 575 587 719 720 780 801 825 915 970 986";
const PHOENIX = "480 520 602 623 928";
const CHICAGO = "204 205 210 214 217 218 219 224 225 228 251 254 256 262 270 281 309 312 314 316 318 319 320 325 331 334 337 346 361 402 405 409 414 417 430 431 432 469 479 501 504 507 512 515 531 534 563 573 580 601 605 608 612 615 618 620 629 630 636 641 651 660 662 682 701 708 712 713 715 726 731 737 763 769 773 779 785 806 815 816 817 830 832 847 850 870 872 901 903 913 918 920 931 936 940 952 956 972 979 985";
const REGINA = "306 639";
const NANP = new Map<string, string>();
for (const [zone, codes] of [["America/Los_Angeles", LA], ["America/Denver", DENVER], ["America/Phoenix", PHOENIX], ["America/Chicago", CHICAGO], ["America/Regina", REGINA], ["America/Anchorage", "907"], ["Pacific/Honolulu", "808"]] as const) {
  for (const code of codes.split(" ")) NANP.set(code, zone);
}

/** One zone per country, longest prefix first. */
const COUNTRY: readonly (readonly [string, string])[] = [
  ["971", "Asia/Dubai"], ["966", "Asia/Riyadh"], ["353", "Europe/Dublin"], ["254", "Africa/Nairobi"], ["234", "Africa/Lagos"], ["92", "Asia/Karachi"], ["91", "Asia/Kolkata"], ["86", "Asia/Shanghai"], ["82", "Asia/Seoul"],
  ["81", "Asia/Tokyo"], ["65", "Asia/Singapore"], ["64", "Pacific/Auckland"], ["49", "Europe/Berlin"], ["44", "Europe/London"], ["39", "Europe/Rome"], ["34", "Europe/Madrid"], ["33", "Europe/Paris"], ["31", "Europe/Amsterdam"], ["27", "Africa/Johannesburg"],
];

export function zoneOfNumber(e164: string): string | null {
  const digits = e164.replace(/^\+/, "");
  if (digits.startsWith("1")) return NANP.get(digits.slice(1, 4)) ?? "America/New_York";
  return COUNTRY.find(([prefix]) => digits.startsWith(prefix))?.[1] ?? null;
}
