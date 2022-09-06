import { TEMPLATE } from "../module/templates.js"
import { DEFAULT_IMG, MODULE_NAME, MODULE_SHORT } from "../module/const.js";
import { CoreUtility } from "./core.js";
import { RollUtility, ROLL_TYPE } from "./roll.js";
import { ITEM_TYPE } from "./item.js";
import { SettingsUtility, SETTING_NAMES } from "./settings.js";

/**
 * A list of different field types that can be provided.
 * @enum {string}
 */
export const FIELD_TYPE = {
    HEADER: 'header',
    FOOTER: 'footer',
    DESCRIPTION: 'description',
    CHECK: 'check',
    ATTACK: 'attack',
    DAMAGE: 'damage',
    SAVE: 'save'
}

/**
 * Utility class to handle all rendering from provided fields into HTML data.
 */
export class RenderUtility {
    static async renderFromField(field, metadata) {
        let [fieldType, fieldData] = field;
        fieldData = mergeObject(metadata, fieldData ?? {}, { recursive: false });

        switch (fieldType) {
            case FIELD_TYPE.HEADER:
                return renderHeader(fieldData);
            case FIELD_TYPE.FOOTER:
                return renderFooter(fieldData);
            case FIELD_TYPE.DESCRIPTION:
                return renderDescription(fieldData);
            case FIELD_TYPE.SAVE:
                return renderSaveButton(fieldData);
            case FIELD_TYPE.CHECK:
                return await renderMultiRoll(fieldData);
            case FIELD_TYPE.ATTACK:
                return await renderAttackRoll(fieldData);
            case FIELD_TYPE.DAMAGE:
                return await renderDamageRoll(fieldData);
        }
    }

    static renderFullCard(props) {
        return renderModuleTemplate(TEMPLATE.FULL_CARD, props);
    }

    static renderItemOptions(props) {
        return renderModuleTemplate(TEMPLATE.OPTIONS, props);
    }
}

function renderHeader(renderData = {}) {
    const { id, item, slotLevel } = renderData;
    const actor = renderData?.actor ?? item?.actor;
    const img = renderData.img ?? item?.img ?? CoreUtility.getActorImage(actor);
    const spellLevel = item?.system.level;
    let title = renderData.title ?? item?.name ?? actor?.name ?? '';

    if (item?.type === ITEM_TYPE.SPELL && slotLevel && slotLevel != spellLevel) {
        title += ` (${CONFIG.DND5E.spellLevels[slotLevel]})`;
    }

    if (item?.type === ITEM_TYPE.TOOL) {
        title += ` (${CONFIG.DND5E.abilities[item.system.ability]})`;
    }

    return renderModuleTemplate(TEMPLATE.HEADER, {
        id,
        item: { img: img ?? DEFAULT_IMG, name: title },
        slotLevel
    });
}

function renderFooter(renderData = {}) {
    const { properties } = renderData;

    return renderModuleTemplate(TEMPLATE.FOOTER, {
        properties
    });
}

function renderDescription(renderData = {}) {
    const { content, isFlavor } = renderData;

    return renderModuleTemplate(TEMPLATE.DESCRIPTION, {
        content,
        isFlavor
    });
}

function renderSaveButton(renderData = {}) {
    const { id, ability, dc, hideDC } = renderData;    

    const abilityLabel = CONFIG.DND5E.abilities[ability];

    return renderModuleTemplate(TEMPLATE.SAVE_BUTTON, {
        id,
        ability,
        abilityLabel,
        hideDC,
        dc
    });
}

async function renderMultiRoll(renderData = {}) {
    const { id, roll, title } = renderData;
    const entries = [];

    // Process bonuses beyond the base d20s into a single roll.
    const bonusTerms = roll.terms.slice(1);
    const bonusRoll = bonusTerms ? Roll.fromTerms(bonusTerms) : null;

    const d20Rolls = roll.dice.find(d => d.faces === 20);
    for (let i = 0; i < d20Rolls.results.length; i++) {
        // Die terms must have active results or the base roll total of the generated roll is 0.
        let tmpResults = [];
        tmpResults.push(d20Rolls.results[i]);

        if (roll.options.halflingLucky && d20Rolls.results[i].result === 1) {
            i++;
            tmpResults.push(d20Rolls.results[i]);
        }

        tmpResults.forEach(r => {
            r.active = !r.rerolled ?? true; 
        });

        const baseTerm = new Die({number: 1, faces: 20, results: tmpResults});
        const baseRoll = Roll.fromTerms([baseTerm]);

        entries.push({
			roll: baseRoll,
			total: baseRoll.total + (bonusRoll?.total ?? 0),
			ignored: tmpResults.some(r => r.discarded) ? true : undefined,
			isCrit: roll.isCritical,
			critType: RollUtility.getCritTypeForDie(baseTerm),
            d20Result: SettingsUtility.getSettingValue(SETTING_NAMES.D20_ICONS_ENABLED) ? d20Rolls.results[i].result : null
		});
    }

    // Generate tooltips (the expandable dice roll information in a chat message).
    const tooltips = await Promise.all(entries.map(e => e.roll.getTooltip()));
    const bonusTooltip = await bonusRoll?.getTooltip();

    return renderModuleTemplate(TEMPLATE.MULTIROLL, {
        id,
        title,
        formula: roll.formula,
        entries,
        tooltips,
        bonusTooltip
    });
}

async function renderAttackRoll(renderData = {}) {
    const { consume } = renderData;

    const title = renderData.title ??
        `${CoreUtility.localize(`${MODULE_SHORT}.chat.${ROLL_TYPE.ATTACK}`)} ${consume ? `[${consume.name}]` : ""}`;

    renderData = mergeObject({ title }, renderData ?? {}, { recursive: false });

    return renderMultiRoll(renderData);
}

async function renderDamageRoll(renderData = {}) {
    const { id, damageType, baseRoll, critRoll, context, versatile } = renderData;
    
    // If there's no content in the damage roll, silently end rendering the field.
    if (baseRoll?.terms.length === 0 && critRoll?.terms.length === 0) return;

    // Get relevant settings for generating the chat card
    const titlePlacement = SettingsUtility.getSettingValue(SETTING_NAMES.PLACEMENT_DAMAGE_TITLE);
    const typePlacement = SettingsUtility.getSettingValue(SETTING_NAMES.PLACEMENT_DAMAGE_TYPE);
    const contextPlacement = SettingsUtility.getSettingValue(SETTING_NAMES.PLACEMENT_DAMAGE_CONTEXT);
    const replaceTitle = SettingsUtility.getSettingValue(SETTING_NAMES.CONTEXT_REPLACE_TITLE);
    const replaceDamage = SettingsUtility.getSettingValue(SETTING_NAMES.CONTEXT_REPLACE_DAMAGE);

    // Generate damage title and context strings
    const labels = {
        1: [],
        2: [],
        3: []
    };

    let damagePrefix = "";
    let pushedTitle = false;
    
    if (CONFIG.DND5E.healingTypes[damageType]) {
        damagePrefix += CONFIG.DND5E.healingTypes[damageType];
    } else if (CONFIG.DND5E.damageTypes[damageType]) {
        damagePrefix += CoreUtility.localize(`${MODULE_SHORT}.chat.${ROLL_TYPE.DAMAGE}`);
        damagePrefix += versatile ? ` [${CONFIG.DND5E.weaponProperties.ver}]` : "";
    } else if (damageType === ROLL_TYPE.OTHER) {
        damagePrefix += CoreUtility.localize(`${MODULE_SHORT}.chat.${ROLL_TYPE.OTHER}`);
    }

    if (titlePlacement !== 0 && !(replaceTitle && context && titlePlacement == contextPlacement)) {
        labels[titlePlacement].push(damagePrefix);
        pushedTitle = true;
    }

    if (context) {
        if (contextPlacement === titlePlacement && pushedTitle) {
            const titleTmp = labels[contextPlacement][0];
            labels[contextPlacement][0] = (titleTmp ? titleTmp + " " : "") + `(${context})`;
        } else if (contextPlacement !== "0") {
            labels[contextPlacement].push(context);
        }
    }

    const damageString = CONFIG.DND5E.damageTypes[damageType] ?? "";
    if (typePlacement !== "0" && damageString.length > 0 && !(replaceDamage && context && typePlacement == contextPlacement)) {
        labels[typePlacement].push(damageString);
    }

    for (let p in labels) {
        labels[p] = labels[p].join(" - ");
    };

    // Generate tooltips (the expandable dice roll information in a chat message).
    const tooltips = (await Promise.all([
        baseRoll?.getTooltip(),
        critRoll?.getTooltip()
    ])).filter(t => t);

    return renderModuleTemplate(TEMPLATE.DAMAGE, {
        id,        
        damageRollType: ROLL_TYPE.DAMAGE,
        tooltips,
        base: baseRoll ? { roll: baseRoll, total: baseRoll.total, critType: RollUtility.getCritTypeForRoll(baseRoll) } : undefined,
        crit: critRoll ? { roll: critRoll, total: critRoll.total, critType: RollUtility.getCritTypeForRoll(critRoll) } : undefined,
        crittext: CoreUtility.localize(`${MODULE_SHORT}.chat.crit`),
        damagetop: labels[1],
        damagemid: labels[2],
        damagebottom: labels[3],
        formula: baseRoll?.formula ?? critRoll.formula,
        damageType,
    });
}

/**
 * Shortcut function to render a custom template from the templates folder.
 * @param {string} template Name (or sub path) of the template in the templates folder.
 * @param {Object} props The props data to render the template with.
 * @returns {Promise<string>} A rendered html template.
 */
function renderModuleTemplate(template, props) {
    return renderTemplate(`modules/${MODULE_NAME}/templates/${template}`, props);
}

