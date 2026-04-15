import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

export function generatePositionBetween(
    before: string | null,
    after: string | null
): string {
    return generateKeyBetween(before, after);
}

export function generateNPositions(
    before: string | null,
    after: string | null,
    n: number
): string[] {
    return generateNKeysBetween(before, after, n);
}

export function generatePositionAtEnd(lastPosition: string | null): string {
    return generateKeyBetween(lastPosition, null);
}

export function generatePositionAtStart(firstPosition: string | null): string {
    return generateKeyBetween(null, firstPosition);
}
