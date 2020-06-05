import { Replacement } from "tslint";
import { SourceFile } from "typescript";

export function getTslintLineReplacement(
    line: string,
    lineStartPosition: number
): Replacement | null {
    const tslintCommentMatchResult = line.match(
        /\s*\t*\/[*\/]\s*tslint:disable-(next-)?line[\w\s]*(\*\/)?\s*/
    );
    if (tslintCommentMatchResult !== null) {
        const positionOfClosingComment = line.indexOf("*/");
        if (positionOfClosingComment !== -1) {
            return Replacement.deleteFromTo(
                (tslintCommentMatchResult.index as number) + lineStartPosition,
                lineStartPosition + positionOfClosingComment + 2
            );
        }
        return Replacement.deleteFromTo(
            (tslintCommentMatchResult.index as number) + lineStartPosition,
            line.length + lineStartPosition
        );
    }
    return null;
}

export function removeTslintComments(file: SourceFile) {
    const replacements: Replacement[] = file
        .getLineStarts()
        .map(lineStartPosition =>
            getTslintLineReplacement(
                file.text.substring(
                    lineStartPosition,
                    file.getLineEndOfPosition(lineStartPosition)
                ),
                lineStartPosition
            )
        )
        .filter(r => r !== null) as Replacement[];
    return Replacement.applyAll(file.text, replacements);
}
