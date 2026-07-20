const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WORKDAY_MS = 8 * 60 * 60 * 1000;
const CUTOFF_MS = 15 * 60 * 60 * 1000;

export type PaidWorkSegment = {
  start_time: string;
  end_time: string | null;
};

export function calculateTimeSegmentPaidDays(segment: PaidWorkSegment): number {
  if (!segment.end_time) return 0;

  const startMs = new Date(segment.start_time).getTime();
  const endMs = new Date(segment.end_time).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 0;
  }

  const durationDays = (endMs - startMs) / WORKDAY_MS;
  const startBangkokMs = startMs + BANGKOK_OFFSET_MS;
  const endBangkokMs = endMs + BANGKOK_OFFSET_MS;
  let cutoffBangkokMs = Math.floor(startBangkokMs / DAY_MS) * DAY_MS + CUTOFF_MS;

  if (cutoffBangkokMs <= startBangkokMs) {
    cutoffBangkokMs += DAY_MS;
  }

  let cutoffDays = 0;
  while (cutoffBangkokMs <= endBangkokMs) {
    cutoffDays += 1;
    cutoffBangkokMs += DAY_MS;
  }

  return cutoffDays > 0 ? cutoffDays : durationDays;
}

export function calculatePaidWorkDays(segments: PaidWorkSegment[] | null | undefined): number {
  return (segments || []).reduce((total, segment) => total + calculateTimeSegmentPaidDays(segment), 0);
}
