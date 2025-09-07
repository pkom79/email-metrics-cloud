/**
 * Simple ESLint plugin rule to discourage raw <select> usage.
 * Allows intentional uses when file contains // select-ok
 */
module.exports = {
    rules: {
        'no-raw-select': {
            meta: { type: 'suggestion', docs: { description: 'Use components/ui/SelectBase instead of native <select>' } },
            create(context) {
                const source = context.getSourceCode().text;
                if (/select-ok/.test(source)) return {};
                return {
                    JSXOpeningElement(node) {
                        if (node.name && node.name.name === 'select') {
                            context.report({ node, message: 'Use components/ui/SelectBase for visual consistency.' });
                        }
                    }
                };
            }
        }
    }
};
