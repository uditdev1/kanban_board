import { describe, test, expect } from "bun:test";
import {
    generatePositionBetween,
    generatePositionAtEnd,
    generatePositionAtStart,
    generateNPositions,
} from "../src/utils/fractional";

describe("Fractional Indexing", () => {
    test("generates a position at the end of an empty list", () => {
        const pos = generatePositionAtEnd(null);
        expect(typeof pos).toBe("string");
        expect(pos.length).toBeGreaterThan(0);
    });

    test("generates a position at the end after an existing position", () => {
        const first = generatePositionAtEnd(null);
        const second = generatePositionAtEnd(first);
        expect(second > first).toBe(true);
    });

    test("generates a position at the start before an existing position", () => {
        const first = generatePositionAtEnd(null);
        const beforeFirst = generatePositionAtStart(first);
        expect(beforeFirst < first).toBe(true);
    });

    test("generates a position between two existing positions", () => {
        const first = generatePositionAtEnd(null);
        const second = generatePositionAtEnd(first);
        const between = generatePositionBetween(first, second);

        expect(between > first).toBe(true);
        expect(between < second).toBe(true);
    });

    test("maintains order consistency across multiple insertions", () => {
        const positions: string[] = [];

        // Generate 10 sequential positions
        let last: string | null = null;
        for (let i = 0; i < 10; i++) {
            const pos = generatePositionAtEnd(last);
            positions.push(pos);
            last = pos;
        }

        // Verify they are in ascending order
        for (let i = 1; i < positions.length; i++) {
            expect(positions[i] > positions[i - 1]).toBe(true);
        }
    });

    test("generates N positions between two values", () => {
        const first = generatePositionAtEnd(null);
        const second = generatePositionAtEnd(first);
        const between = generateNPositions(first, second, 3);

        expect(between.length).toBe(3);

        // All should be between first and second
        for (const pos of between) {
            expect(pos > first).toBe(true);
            expect(pos < second).toBe(true);
        }

        // They should be in order amongst themselves
        for (let i = 1; i < between.length; i++) {
            expect(between[i] > between[i - 1]).toBe(true);
        }
    });

    test("can insert between the same two positions many times without collision", () => {
        const first = generatePositionAtEnd(null);
        const second = generatePositionAtEnd(first);

        const inserted: string[] = [];
        let a = first;
        let b = second;

        // Insert 20 items between the same two positions
        for (let i = 0; i < 20; i++) {
            const mid = generatePositionBetween(a, b);
            inserted.push(mid);
            b = mid; // Keep inserting at the start
        }

        // All should be unique
        const unique = new Set(inserted);
        expect(unique.size).toBe(inserted.length);
    });

    test("string comparison matches expected ordering", () => {
        const positions = [
            generatePositionAtEnd(null),
            generatePositionAtEnd(generatePositionAtEnd(null)),
        ];

        // Using localeCompare should give correct order
        const sorted = [...positions].sort((a, b) => a.localeCompare(b));
        expect(sorted).toEqual(positions);
    });
});
