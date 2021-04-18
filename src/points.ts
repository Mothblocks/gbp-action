import { Configuration } from "./configuration"
import { GithubUser } from "./github"
import { promises as fs } from "fs"
import { isRight } from "fp-ts/lib/Either"
import * as t from "io-ts"
import * as toml from "toml"
import path from "path"

export const HEADER =
    "# This file is @generated by the GBP actions. " +
    "If you edit this, preserve the format, and ensure IDs are sorted in numerical order.\n"

const BALANCES_FILE = "./.github/gbp-balances.toml"

/// User IDs -> balances
const validateBalances = t.record(t.string, t.number)

export function getPointsFromLabels(
    configuration: Configuration,
    labels: string[],
): number {
    if (
        configuration.no_balance_label !== undefined &&
        labels.indexOf(configuration.no_balance_label) !== -1
    ) {
        return 0
    }

    switch (configuration.collection_method) {
        case "high_vs_low":
        case undefined:
            return collectPointsHighVsLow(configuration, labels)
        case "sum":
            return collectPointsSum(configuration, labels)
    }
}

function collectPointsHighVsLow(
    configuration: Configuration,
    labels: string[],
): number {
    let positiveValue = 0
    let negativeValue = 0

    for (const label of labels) {
        const value = configuration.points.get(label)
        if (value === undefined) {
            continue
        }

        if (value > 0) {
            positiveValue = Math.max(positiveValue, value)
        } else {
            negativeValue = Math.min(negativeValue, value)
        }
    }

    return positiveValue + negativeValue
}

function collectPointsSum(
    configuration: Configuration,
    labels: string[],
): number {
    return labels.reduce((value, label) => {
        return value + (configuration.points.get(label) || 0)
    }, 0)
}

function getUserId(line: string): number | undefined {
    const userId = parseInt(line.split(" ")[0], 10)
    if (Number.isNaN(userId)) {
        return undefined
    }

    return userId
}

function getBalancePath(basePath?: string): string {
    return basePath ? path.join(basePath, BALANCES_FILE) : BALANCES_FILE
}

export async function readBalanceFile(
    basePath?: string,
): Promise<string | undefined> {
    return fs
        .open(getBalancePath(basePath), "r")
        .then((file) =>
            file.readFile({
                encoding: "utf-8",
            }),
        )
        .catch(() => {
            return undefined
        })
}

export function readBalances(text: string): t.TypeOf<typeof validateBalances> {
    const balancesEither = validateBalances.decode(toml.parse(text))
    if (isRight(balancesEither)) {
        return balancesEither.right
    } else {
        throw balancesEither.left
    }
}

export function setBalance(
    tomlOutput: string | undefined,
    user: GithubUser,
    newBalance: number,
): string {
    const balanceLine = `${user.id} = ${newBalance} # ${user.login}`
    if (tomlOutput === undefined) {
        return HEADER + balanceLine
    }

    const replaceRegex = new RegExp(`${user.id} = .*`, "gm")
    const newOutput = tomlOutput.replace(replaceRegex, balanceLine)

    if (newOutput !== tomlOutput) {
        return newOutput
    }

    // Brand new name, find where it is in order
    const lines = tomlOutput.split("\n")

    for (const [lineNumber, line] of lines.entries()) {
        const userId = getUserId(line)
        if (userId === undefined) {
            continue
        }

        if (user.id < userId) {
            const linesUpdated = [...lines]
            linesUpdated.splice(lineNumber, 0, balanceLine)
            return linesUpdated.join("\n")
        }
    }

    return `${tomlOutput}\n${balanceLine}`
}

export async function writeBalanceFile(contents: string, basePath?: string) {
    return fs.writeFile(getBalancePath(basePath), contents, {
        encoding: "utf-8",
    })
}
