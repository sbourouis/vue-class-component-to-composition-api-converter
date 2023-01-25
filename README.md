<h1 align="center">
  <br>
  vue-class-component-to-composition-api-converter
  <br>
  <br>
</h1>
<h4 align="center">A script to convert your Vue class components to script setup</h4>

**vue-class-component-to-composition-api-converter** is a simple node script that converts your Vue components that are using [vue-class-component](https://github.com/vuejs/vue-class-component) to the composition API with script setup syntax.

### Usage

```bash
node index.js PATH/Component.vue
```

will generate `results/Component.vue`. You will then have to review the file and address any issues or comments added to it.
Once that's done, you can replace your component with that file.

### Limitations

TBD