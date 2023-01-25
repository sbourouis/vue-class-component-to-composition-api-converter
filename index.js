const fs = require('fs');
const path = require('path');

function getPosition(string, subString, index) {
  return string.split(subString, index).join(subString).length;
}

const getComputed = (content) => content.match(/get .*/g)?.map((fnStart) => {
  const start = content.substring(content.indexOf(fnStart) + fnStart.lastIndexOf('{'));
  const fn = getFunctionContent(start);
  const name = fnStart.substring('get '.length, fnStart.indexOf(`()`));
  const typeStartIndex = fnStart.indexOf(':') + 1;
  const type = typeStartIndex ? `<${fnStart.substring(typeStartIndex, fnStart.lastIndexOf(`{`)).replaceAll(' ', '')}>` : '';
  return `const ${name} = computed${type}(() => ${fn});`;
}).join('\n') || '';

const getFunctionContent = (content) => {
  const openingIndex = content.indexOf('{');
  let i = 0;
  let closingIndex = content.indexOf('}');
  let fn = content.substring(openingIndex, closingIndex + 1);
  let opening = (fn.match(/\{/g) || []).length;
  let closing = (fn.match(/}/g) || []).length;
  while (closing < opening) {
    i++;
    closingIndex = getPosition(content, '}', i);
    fn = content.substring(openingIndex, closingIndex + 1);
    opening = (fn.match(/\{/g) || []).length;
    closing = (fn.match(/\}/g) || []).length;
  }
  return fn;
};

const getMethods = (content) => {
  const starts = (content.match(/\S.*\(.*\).*{/g) || []).filter((fn) => !fn.startsWith('get ') && !fn.includes(' (') && !fn.includes('.'));
  const lifecycleHooks = {
    beforeCreate: 'onBeforeMount',
    created: 'onBeforeMount',
    mounted: 'onMounted',
    beforeUnmount: 'onBeforeUnmount',
    unmounted: 'onBeforeUnmount'
  };
  let watchers = '';
  const functions = starts.map((fnStart) => {
    const start = content.substring(content.indexOf(fnStart) + fnStart.lastIndexOf('{'));
    let fn = getFunctionContent(start);
    const name = fnStart.substring(fnStart.indexOf('async ') === -1 ? 0 : 'async '.length, fnStart.indexOf(`(`));
    const isAsync = fnStart.includes('async ');
    if (Object.keys(lifecycleHooks).includes(name)) {
      // TODO: add watchers options (immediate, deep, etc)
      // FIXME: one liners + no arrow
      const watchersMatch = fn.match(/(const .* = )?this.\$watch/g);
      if (watchersMatch) {
        let closing = 0;
        for (let i = 1; i <= watchersMatch.length; i++) {
          const position = getPosition(fn, watchersMatch[i - 1], i);
          const fnStart = fn.substring(position + watchersMatch[i - 1].length, fn.indexOf('=>')).replace('(', '');
          const isAsync = fnStart.includes('async');
          const args = fnStart.match(/\(.*\)/)?.[0];
          const name = fnStart.match(/'\S*'/)?.[0];
          const constantName = watchersMatch[i - 1].match(/const .* = /)?.[0] ?? '';
          const watcher = getFunctionContent(fn.substring(position));
          closing += watcher.match(/}\);/)?.length ?? 0;
          const closingPosition = getPosition(fn, '});', i + closing);
          if (name === '\'$route\'') {
            watchers += '\n// FIXME: use a computed property to watch the route changes';
          }
          watchers += `\n${constantName}watch(${name}, ${isAsync ? 'async ' : ''}${args} => ${watcher});\n`;
          fn = fn.substring(0, position) + fn.substring(closingPosition + '});'.length);
        }
      }
      if (fn.replace('{', '').replace('}', '').match(/\S/)) {
        return `${lifecycleHooks[name]}(${isAsync ? 'async ' : ''}() => ${fn});`;
      }
      return '';
    }
    const args = fnStart.substring(fnStart.indexOf('(') + 1, fnStart.indexOf(`)`));
    const returnType = fnStart.includes('): ') ? fnStart.substring(fnStart.indexOf('): ') + 1, fnStart.indexOf(' {')) : '';
    return `const ${name} = ${isAsync ? 'async ' : ''}(${args})${returnType} => ${fn};`;
  }).join('\n');
  return watchers + functions;
};

const getScript = (content) => {
  const scriptStart = content.indexOf('<script');
  const scriptEnd = content.lastIndexOf('</script>') + '</script>'.length;
  return content.substring(scriptStart, scriptEnd);
};
const getClassContent = (content) => {
  const arr = content.split('\n');
  const start = arr.findIndex((line) => line.startsWith('export default class '));
  return start > -1 ? arr.slice(start + 1, arr.length - 2).join('\n') : null;
};
const emitNameToFnDef = (name) => `(e: '${name}'): void`;
const getEmits = (content) => {
  const emitsName = content.split('\n')
    .filter((line) => line.includes('$emit('))
    .map((line) => {
      const l = line.substring(line.indexOf('$emit(\'') + '$emit(\''.length);
      return l.substring(0, l.indexOf('\''));
    })
    .filter((value, index, self) => self.indexOf(value) === index);
  // TODO: improve to add arg types when possible
  if (emitsName.length) {
    const todo = '// TODO: please add emits values definition\n';
    return `${todo}const emit = defineEmits<{\n${emitsName.map((value) => `  ${emitNameToFnDef(value)}`).join(';\n')}\n}>();`;
  }
  return '';
};
const useI18n = (content) => {
  let imports = '';
  if (content.includes('this.$t')) {
    imports = 't';
  }
  if (content.includes('this.$te')) {
    if (imports.length) {
      imports += ', te';
    } else {
      imports += 't';
    }
  }
  if (content.includes('this.$d')) {
    if (imports.length) {
      imports += ', d';
    } else {
      imports += 'd';
    }
  }
  if (imports.length) {
    return `const { ${imports} } = useI18n();\n`;
  }
  return '';
};
const getRouterConstants = (script) => {
  let imports = '';
  if (script.includes('$router')) {
    imports += 'const router = useRouter();\n';
  }
  if (script.includes('$route.') || script.includes('\'$route\'')) {
    imports += 'const route = useRoute();\n';
  }
  return imports;
};
const getImports = (script) => {
  let imports = '';
  if (script.includes('this.$t')) {
    imports += 'import { useI18n } from \'vue-i18n\';\n';
  }
  if (script.includes('this.$router') && (script.includes('$route.') || script.includes('\'$route\''))) {
    imports += 'import { useRoute, useRouter } from \'vue-router\';\n';
  } else if (script.includes('this.$router')) {
    imports += 'import { useRouter } from \'vue-router\';\n';
  } else if (script.includes('$route.') || script.includes('\'$route\'')) {
    imports += 'import { useRoute } from \'vue-router\';\n';
  }
  return `${imports}${script.split(';\n')
    .filter((str) => (str.includes('import ') && !str.includes('vue-class-component')) || str.startsWith('dayjs.extend('))
    .join(';\n')};\n`;
};
const getProps = (script) => {
  if (script.includes('@Options') && script.includes('props:')) {
    const fromOptions = script.substring(script.indexOf('@Options(') + '@Options('.length);
    const propsStart = fromOptions.substring(fromOptions.indexOf('props: {'));
    let props = getFunctionContent(propsStart);
    // TODO: remove unused props?
    script.match(/\S*!: .*;/g)?.map((declaration) => {
      const name = declaration.split('!')[0];
      const type = declaration.split('!: ').pop().replace(';', '');
      if (!['string', 'number', 'boolean', 'void', 'any'].includes(type)) {
        props = props.split('}');
        const index = props.findIndex((part) => part.includes(`${name}:`));
        if (index >= 0) {
          const t = props[index].match(/type: .*,/g)?.[0]?.split(': ').pop().replace(',', '');
          const value = props[index].replace(`type: ${t}`, `type: ${t} as PropType<${type}>`);
          props.splice(index, 1, value);
        }
        props = props.join('}');
      }
    });
    return `const props = defineProps(${props.trim()});`;
  }
  return '';
};
const getProvide = (script) => {
  let result = '';
  if (script.includes('@Options') && script.includes('provide()')) {
    const fromOptions = script.substring(script.indexOf('@Options(') + '@Options('.length);
    const provideStart = fromOptions.substring(fromOptions.indexOf('provide() {'));
    const provides = getFunctionContent(provideStart);
    provides.match(/\S*: .*/g)?.map((declaration) => {
      const split = declaration.split(':');
      const name = split[0].trim();
      const funct = split[1].trim();
      result += `\nprovide('${name}', ${funct});`;
    });
  }
  return result;
};
const getConstants = (script, template) => script
  .match(/ .* =.*/g)
  ?.filter((line) => !line.includes('const ') && !line.includes('let ') && !line.includes('    '))
  .map((line) => {
    const substr = script.substring(script.indexOf(line));
    const declaration = substr.substring(0, substr.indexOf(';'));
    const name = line.trim().split(' ')[0].replace(':', '');
    const type = line.indexOf(':') > -1 ? line.substring(line.indexOf(':') + 1).split('=')[0]?.trim() : null;
    const value = declaration.trim().split('=').pop().replace(';', '').trim();
    // TODO: improve to add reactive and make sure we don't set ref.value.prop = value
    if (script.includes(`this.${name} =`) || template.includes(`${name} =`) || template.includes(`v-model="${name}"`)) {
      return `const ${name} = ref${type ? `<${type}>` : ''}(${value})`;
    }
    return `const ${name}${type ? ` :${type}` : ''} = ${value}`;
  }).join('\n') || '';
const getRefs = (template) => template.match(/((^ref)|( ref))=".*"/g)?.map((ref) => {
  const name = ref.split('"')[1];
  return name ? `const ${name} = ref(null)` : '';
}).join('\n') || '';

const getVueImports = (finalContent) => {
  const imports = ['defineProps', 'defineEmits', 'watch', 'nextTick', 'ref', 'provide', 'reactive', 'PropType', 'computed', 'defineAsyncComponent', 'onBeforeMount', 'onMounted', 'onBeforeUnmount']
    .sort()
    .filter((i) => finalContent.includes(i));
  return imports.length ? `import { ${imports.join(', ')} } from 'vue';\n` : '';
};

const getTemplate = (content) => {
  const templateStart = content.indexOf('<template>');
  const templateEnd = content.lastIndexOf('</template>') + '</template>'.length;
  return content.substring(templateStart, templateEnd);
};

const getStyle = (content) => {
  const styleStart = content.indexOf('<style');
  const styleEnd = content.lastIndexOf('</style>') + '</style>'.length;
  return styleStart >= 0 ? content.substring(styleStart, styleEnd) : '';
};

const getNonSetupScript = (script) => {
  if (script.includes('inheritAttrs')) {
    return `<script lang="ts">
export default {
  inheritAttrs: false
};
</script>

`;
  }
  return '';
};

const filePath = process.argv[2];

if (filePath) {
  const file = fs.readFileSync(path.join(process.cwd(), filePath))?.toString();
  const script = getScript(file);

  if (script.includes('export default class ')) {
    const classContent = getClassContent(script);
    const template = getTemplate(file);
    const style = getStyle(file);
    const imports = getImports(script);
    const props = getProps(script);
    let provides = getProvide(script);
    const emits = getEmits(file);
    const nonSetupScript = getNonSetupScript(file);
    let constants = getConstants(classContent, template);
    const refs = getRefs(template);
    let computed = getComputed(classContent).replaceAll('this.$', '');
    let methods = getMethods(classContent).replaceAll('this.$', '');
    const punctuations = ['.', ' ', ';', ')', '?', ',', '\n', '[', ']', '}'];
    props.match(/\S*: \{/g)?.map((prop) => {
      const name = prop.split(':')[0];
      punctuations.map((punctuation) => {
        computed = computed.replaceAll(`this.${name}${punctuation}`, `props.${name}${punctuation}`);
        methods = methods.replaceAll(`this.${name}${punctuation}`, `props.${name}${punctuation}`);
        constants = constants.replaceAll(`this.${name}${punctuation}`, `props.${name}${punctuation}`);
      });
      methods = methods.replaceAll(`watch('${name}'`, `watch(() => props.${name}`);
    });
    computed.match(/const .* = computed/g)?.map((value) => {
      const name = value.replaceAll('const ', '').replaceAll(' = computed', '');
      punctuations.map((punctuation) => {
        computed = computed.replaceAll(`this.${name}${punctuation}`, `${name}.value${punctuation}`);
        methods = methods.replaceAll(`this.${name}${punctuation}`, `${name}.value${punctuation}`);
      });
      methods = methods.replaceAll(`watch('${name}'`, `watch(${name}`);
    });
    constants.match(/const .* = (ref)?/g)?.map((value) => {
      const name = value.split(' ')[1];
      if (value.split(' ').pop().includes('ref')) {
        punctuations.map((punctuation) => {
          methods = methods.replaceAll(`this.${name}${punctuation}`, `${name}.value${punctuation}`);
          computed = computed.replaceAll(`this.${name}${punctuation}`, `${name}.value${punctuation}`);
          methods = methods.replaceAll(`this.$refs.${name}${punctuation}`, `${name}.value${punctuation}`);
          computed = computed.replaceAll(`this.$refs.${name}${punctuation}`, `${name}.value${punctuation}`);
        });
        methods = methods.replaceAll(`watch('${name}'`, `watch(${name}`);
      } else {
        methods = methods.replaceAll(`this.${name}`, `${name}`);
        computed = computed.replaceAll(`this.${name}`, `${name}`);
      }
    });
    methods.match(/const .* =( async)? \(.*\):?/g)?.map((value) => {
      const name = value.split(' ')[1];
      methods = methods.replaceAll(`this.${name}(`, `${name}(`);
      computed = computed.replaceAll(`this.${name}(`, `${name}(`);
      provides = provides.replaceAll(`this.${name}`, `${name}`);
    });
    refs.match(/const .* = (ref)?/g)?.map((value) => {
      const name = value.split(' ')[1];
      punctuations.map((punctuation) => {
        methods = methods.replaceAll(`refs.${name}${punctuation}`, `${name}.value${punctuation}`);
        computed = computed.replaceAll(`refs.${name}${punctuation}`, `${name}.value${punctuation}`);
      });
    });
    const i18nImports = useI18n(classContent);
    const routerImports = getRouterConstants(classContent);
    const content = `${imports}\n${i18nImports}${routerImports}${props}\n${emits}\n\n${refs}\n\n${constants}\n\n${computed}\n\n${methods}${provides}\n`;
    const vueImports = getVueImports(content);
    const result = `${nonSetupScript}<script setup lang="ts">\n${vueImports}${content}</script>\n\n${template}\n${style}\n`;
    const dir = 'results';
    const newFilePath = `${dir}/${filePath.split('/').pop()}`;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    fs.writeFileSync(newFilePath, result);
    console.log(`File generated in ${newFilePath}`);
  } else {
    console.error('Please provide a vue file that uses the Options API with vue-class-component');
  }
} else {
  console.error('Please provide file path');
}
