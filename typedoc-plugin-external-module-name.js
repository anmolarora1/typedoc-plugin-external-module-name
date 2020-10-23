var __decorate =
  (this && this.__decorate) ||
  function (decorators, target, key, desc) {
    var c = arguments.length,
      r = c < 3 ? target : desc === null ? (desc = Object.getOwnPropertyDescriptor(target, key)) : desc,
      d;
    if (typeof Reflect === 'object' && typeof Reflect.decorate === 'function')
      r = Reflect.decorate(decorators, target, key, desc);
    else
      for (var i = decorators.length - 1; i >= 0; i--)
        if ((d = decorators[i])) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
  };
(function (factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    var v = factory(require, exports);
    if (v !== undefined) module.exports = v;
  } else if (typeof define === 'function' && define.amd) {
    define([
      'require',
      'exports',
      'path',
      'fs',
      'typedoc/dist/lib/converter/components',
      'typedoc/dist/lib/converter/converter',
      './typedocVersionCompatibility',
      './getRawComment',
    ], factory);
  }
})(function (require, exports) {
  'use strict';
  Object.defineProperty(exports, '__esModule', { value: true });
  exports.ExternalModuleNamePlugin = void 0;
  const path = require('path');
  const fs = require('fs');
  const components_1 = require('typedoc/dist/lib/converter/components');
  const converter_1 = require('typedoc/dist/lib/converter/converter');
  const typedocVersionCompatibility_1 = require('./typedocVersionCompatibility');
  const getRawComment_1 = require('./getRawComment');
  const PLUGIN = 'typedoc-plugin-external-module-name';
  const CUSTOM_SCRIPT_FILENAME = `.${PLUGIN}.js`;
  /**
   * This plugin allows an ES6 module to specify its TypeDoc name.
   * It also allows multiple ES6 modules to be merged together into a single TypeDoc module.
   *
   * @usage
   * At the top of an ES6 module, add a "dynamic module comment".  Insert "@module typedocModuleName" to
   * specify that this ES6 module should be merged with module: "typedocModuleName".
   *
   * Similar to the [[DynamicModulePlugin]], ensure that there is a comment tag (even blank) for the
   * first symbol in the file.
   *
   * @example
   * ```
   *
   * &#47;**
   *  * @module newModuleName
   *  *&#47;
   * &#47;** for typedoc &#47;
   * import {foo} from "../foo";
   * export let bar = "bar";
   * ```
   *
   * Also similar to [[DynamicModulePlugin]], if @preferred is found in a dynamic module comment, the comment
   * will be used as the module comment, and documentation will be generated from it (note: this plugin does not
   * attempt to count lengths of merged module comments in order to guess the best one)
   */
  let ExternalModuleNamePlugin = class ExternalModuleNamePlugin extends components_1.ConverterComponent {
    constructor() {
      super(...arguments);
      /** List of module reflections which are models to rename */
      this.moduleRenames = [];
      this.baseDir = '';
      this.defaultGetModuleNameFn = (match, guess) => match || guess;
      this.disableAutoModuleName = false;
    }
    initialize() {
      this.listenTo(this.owner, {
        [converter_1.Converter.EVENT_BEGIN]: this.onBegin,
        [converter_1.Converter.EVENT_CREATE_DECLARATION]: this.onDeclaration,
        [converter_1.Converter.EVENT_RESOLVE_BEGIN]: this.onBeginResolve,
      });
      const pathToScript = path.join(process.cwd(), CUSTOM_SCRIPT_FILENAME);
      try {
        if (fs.existsSync(pathToScript)) {
          const relativePath = path.relative(__dirname, pathToScript);
          this.customGetModuleNameFn = require(relativePath);
          console.log(`${PLUGIN}: Using custom module name mapping function from ${pathToScript}`);
        }
      } catch (error) {
        console.error(`${PLUGIN}: Failed to load custom module name mapping function from ${pathToScript}`);
        throw error;
      }
    }
    onBegin(context) {
      /** Get the program entry points */
      const dir = context.program.getCurrentDirectory();
      const rootFileNames = context.program.getRootFileNames();
      const options = context.getCompilerOptions();
      function commonPrefix(string1, string2) {
        let idx = 0;
        while (idx < string1.length && string1[idx] === string2[idx]) {
          idx++;
        }
        return string1.substr(0, idx);
      }
      const commonParent = rootFileNames.reduce(
        (acc, entry) => commonPrefix(acc, path.dirname(path.resolve(dir, entry))),
        path.resolve(!!rootFileNames.length ? rootFileNames[0] : '.'),
      );
      this.baseDir = options.rootDir || options.baseUrl || commonParent;
      /** Process options */
      const option = this.application.options.getValue('disableAutoModuleName');
      this.disableAutoModuleName = option === 'true' || option === true;
    }
    /**
     * Gets the module name for a reflection
     *
     * Order of precedence:
     * 1) custom function found in .typedoc-plugin-external-module-name.js
     * 2) explicit @module tag
     * 3) auto-create a module name based on the directory
     */
    getModuleName(context, reflection, node) {
      const comment = getRawComment_1.getRawComment(node);
      const preferred = /@preferred/.exec(comment) != null;
      // Look for @module
      const [, match] = /@module\s+([\w\u4e00-\u9fa5\.\-_/@"]+)/.exec(comment) || [];
      // Make a guess based on enclosing directory structure
      const filename = reflection.sources[0].file.fullFileName;
      let guess = this.disableAutoModuleName ? undefined : path.dirname(path.relative(this.baseDir, filename));
      if (guess === '.') {
        guess = 'root';
      }
      // Try the custom function
      const mapper = this.customGetModuleNameFn || this.defaultGetModuleNameFn;
      const moduleName = mapper(match, guess, filename, reflection, context);
      return [moduleName, preferred];
    }
    /**
     * Process a reflection.
     * Determine the module name and add it to a list of renames
     */
    onDeclaration(context, reflection, node) {
      if (typedocVersionCompatibility_1.isModuleOrNamespace(reflection)) {
        const [moduleName, preferred] = this.getModuleName(context, reflection, node);
        if (moduleName) {
          // Set up a list of renames operations to perform when the resolve phase starts
          this.moduleRenames.push({
            renameTo: moduleName,
            preferred: preferred != null,
            symbol: node.symbol,
            reflection: reflection,
          });
        }
      }
      // Remove the tags
      if (reflection.comment) {
        typedocVersionCompatibility_1.removeTags(reflection.comment, 'module');
        typedocVersionCompatibility_1.removeTags(reflection.comment, 'preferred');
        if (isEmptyComment(reflection.comment)) {
          delete reflection.comment;
        }
      }
    }
    /**
     * OK, we saw all the reflections.
     * Now process the renames
     */
    onBeginResolve(context) {
      let projRefs = context.project.reflections;
      let refsArray = Object.values(projRefs);
      // Process each rename
      this.moduleRenames.forEach((item) => {
        let renaming = item.reflection;
        // Find or create the module tree until the child's parent (each level is separated by .)
        let nameParts = item.renameTo.split('.');
        let parent = context.project;
        for (let i = 0; i < nameParts.length - 1; ++i) {
          let child = parent.children.filter((ref) => ref.name === nameParts[i])[0];
          if (!child) {
            child = typedocVersionCompatibility_1.createChildReflection(parent, nameParts[i]);
            child.parent = parent;
            child.children = [];
            context.project.reflections[child.id] = child;
            parent.children.push(child);
          }
          parent = child;
        }
        // Find an existing module with the child's name in the last parent. Use it as the merge target.
        let mergeTarget = parent.children.filter(
          (ref) => ref.kind === renaming.kind && ref.name === nameParts[nameParts.length - 1],
        )[0];
        // If there wasn't a merge target, change the name of the current module, connect it to the right parent and exit.
        if (!mergeTarget) {
          renaming.name = nameParts[nameParts.length - 1];
          let oldParent = renaming.parent;
          for (let i = 0; i < oldParent.children.length; ++i) {
            if (oldParent.children[i] === renaming) {
              oldParent.children.splice(i, 1);
              break;
            }
          }
          item.reflection.parent = parent;
          parent.children.push(renaming);
          typedocVersionCompatibility_1.updateSymbolMapping(context, item.symbol, parent);
          return;
        }
        typedocVersionCompatibility_1.updateSymbolMapping(context, item.symbol, mergeTarget);
        if (!mergeTarget.children) {
          mergeTarget.children = [];
        }
        // Since there is a merge target, relocate all the renaming module's children to the mergeTarget.
        let childrenOfRenamed = refsArray.filter((ref) => ref.parent === renaming);
        childrenOfRenamed.forEach((ref) => {
          // update links in both directions
          ref.parent = mergeTarget;
          mergeTarget.children.push(ref);
        });
        // If @preferred was found on the current item, update the mergeTarget's comment
        // with comment from the renaming module
        if (item.preferred) mergeTarget.comment = renaming.comment;
        // Now that all the children have been relocated to the mergeTarget, delete the empty module
        // Make sure the module being renamed doesn't have children, or they will be deleted
        if (renaming.children) renaming.children.length = 0;
        typedocVersionCompatibility_1.removeReflection(context.project, renaming);
        // Remove @module and @preferred from the comment, if found.
        if (mergeTarget.comment) {
          typedocVersionCompatibility_1.removeTags(mergeTarget.comment, 'module');
          typedocVersionCompatibility_1.removeTags(mergeTarget.comment, 'preferred');
        }
        if (isEmptyComment(mergeTarget.comment)) {
          delete mergeTarget.comment;
        }
      });
    }
  };
  ExternalModuleNamePlugin = __decorate(
    [components_1.Component({ name: 'external-module-name' })],
    ExternalModuleNamePlugin,
  );
  exports.ExternalModuleNamePlugin = ExternalModuleNamePlugin;
  function isEmptyComment(comment) {
    return !comment || (!comment.text && !comment.shortText && (!comment.tags || comment.tags.length === 0));
  }
});