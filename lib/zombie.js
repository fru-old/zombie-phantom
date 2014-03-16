var phantom = require('node-phantom');
var _ =       require('underscore');

/**
 * Create the Zombie shim around the PhantomJS browser.
 *
 * @param {type} options
 * @returns {Zombie}
 */
var Zombie = function(options, callback) {  
  this.options = _.extend({
    site: ''
  }, options || {});

  this.parameters = options.parameters;
  this.phantomPath = options.phantomPath;
  this.page = null;
  this.phantom = phantom;
  this.phantomInstance = null;
};

/**
 * Private(ish) method to get the current page of PhantomJS.
 *
 * @param {function} callback
 *   Called when the page is retrieved.
 *
 * @returns {object}
 *   The PhantomJS Page.
 */
Zombie.prototype._getPage = function(callback) {
  var self = this;
  if (!this.page) {
    var params = {};
    if (this.parameters) {
      params.parameters = this.parameters;
    }
    if (this.phantomPath) {
      params.phantomPath = this.phantomPath;
    }
    phantom.create(function(error, inst) {
      self.phantomInstance = inst;
      inst.createPage(function(error, page) {
        page.onLoadStarted = function() {
          self.loading = true;
        };
        page.onLoadFinished = function() {
          self.loading = false;
        };
        self.page = page;
        done();
      });
    }, params);
  }
  else done();

  function done(){
    self.wait(function(){
      callback.call(self, self.page);
    });
  }
};

/**
 * Wait for a page to load and callback when it is done.
 *
 * @param {function} callback
 *   Called when the page is done loading.
 */
Zombie.prototype.wait = function(callback) {
  var self = this;
  if (this.loading) {
    setTimeout(function() {
      self.wait(callback);
    }, 100);
  }
  else {
    callback();
  }
  return this;
};

/**
 * Evaluate on phantomjs process
 *
 * @param {function} func
 *   This is evaluate in phantomjs
 * @param {function} cb
 *   Called when the browser has evaluated func.
 * @param {object} param
 *   Parameter that is serialized and passed into func
 */
Zombie.prototype.execute = function(func, cb, param){
  //Reserved prefix that should only be used locally 
  var prefix = "__node_phantom_reserved_";
  param[prefix+'payload'] = func.toString();

  this._getPage(function(page) {
    //executes func while wrapping native objects
    page.evaluate(Zombie.interceptor, cb, param);
  });
}

/**
 * Visit a webpge.
 *
 * @param {string} url
 *   The url to visit.
 * @param {function} callback
 *   Called when the browser has visited the url.
 */
Zombie.prototype.visit = function(url, callback) {
  this._getPage(function(page) {
    page.open(this.options.site + url, callback);
  });
};

/**
 * This function runs on the client side in phantomjs. It gets a stringified function
 * called payload which is executed on phantomjs as well. This wrappes the payload and
 * replaces any parameter or return values that are not serializable like html elements 
 * with serializable json. These act like placeholders and represent the orignal object 
 * and these can then be passed inbetween node and phantom.
 *
 * @param {object} param
 *   Parameter that is passed to this method by phantomjs. This also contains the JS 
 *   payload function.
 */
Zombie.interceptor = function(param){
  //We can't access the outer scope so we redefine prefix.
  var prefix = "__node_phantom_reserved_";

  //Extract the payload function from param.
  var payload = null;
  eval('payload = '+param[prefix+'payload']+';');
  if(typeof(payload) !== 'function')return;
  delete param[prefix+'payload'];
  
  //Replace some types with serializable placeholders.
  var replaced = ["HTMLElement"];
  var maxDepth = 12;
  var store = window[prefix+'store'] || (window[prefix+'store'] = []);
  var winid = window[prefix+'winid'] || (window[prefix+'winid'] = Math.random());
  
  function toNode(o){
    for(var i = 0; i < replaced.length; i++){
      if(o instanceof window[replaced[i]]){
        store.push(o);
        return {
          special: prefix+'obj',  
          id: store.length-1,
          winid: winid,
          type: replaced[i]
        };
      }
    }
    return o;
  }
  
  function fromNode(o){
    if(o && o.special === prefix+'obj' && o.winid === winid){
      return store.length > o.id ? store[o.id] : null;
    }
    return o;
  }
  
  function recurse(o, func, depth){
    if(!depth)depth = 0;
    for(p in o){
      var newo = func(o[p]);
      if(newo === o[p] && depth < maxDepth)recurse(newo, func, depth + 1);
      else o[p] = newo;
    }
    return o;
  }
  
  //Invoke payload and do conversion
  param = recurse(param, fromNode);
  var result = payload.call(null, param);
  return recurse(result, toNode);
}

/**
 * Fill an item at a selector with a value.
 *
 * @param {string} selector
 *   A selector for the element you wish to fill.
 * @param {string} value
 *   The value of the element you wish to fill.
 * @param {function} callback
 *   A callback function to call when it is done.
 */
Zombie.prototype.fill = function(selector, value, callback) {
  this.execute(function(args){
    var element = document.querySelector(args.selector);
    if(element)element.value = args.value;
    return element;
  }, callback, {
    selector: selector,
    value: value
  });
};

/**
 * Clicks on a link.
 *
 * @param {string} selector
 *   The selector of what you wish to click.
 * @param {function} callback
 *   Called when the item has been clicked.
 */
Zombie.prototype.clickLink = function(selector, callback) {
  //TODO fix
  var self = this;
  this._getPage(function(page) {
    page.evaluate(function(selector) {
      window.location.href = phQuery(selector).attr('href');
      return true;
    }, function() {
      self.loading = true;
      self.wait(function() {
        self._initializePage(page, callback);
      });
    }, selector);
  });
}

/**
 * Press a button within the page.
 *
 * @param {string} selector
 *   A selector of the button you wish to press.
 * @param {function} callback
 *   A callback function to be called when the button is pressed.
 */
Zombie.prototype.pressButton = function(selector, callback) {


  this.execute(function(args){
    var element = document.querySelector(args.selector);
    if(element){
      var evt = document.createEvent("MouseEvents");
      evt.initMouseEvent("click", true, true, window, 1, 0, 0, 0, 0,
        false, false, false, false, 0, null);
      element.dispatchEvent(evt);
    }
    return element;
  }, callback, {
    selector: selector
  });
};

/**
 * Wait for phantom to redirect.
 *  
 * @param {function} callback
 *   A callback function to be called when phantom redirected.
 */
Zombie.prototype.pressButton = function(selector, callback) {
  this.execute(function(args){
    var element = document.querySelector(args.selector);
    if(element){
      var evt = document.createEvent("MouseEvents");
      evt.initMouseEvent("click", true, true, window, 1, 0, 0, 0, 0,
        false, false, false, false, 0, null);
      element.dispatchEvent(evt);
    }
    return element;
  },callback,{
    selector: selector
  });
};

/**
 * Select an option on the page.
 *
 * @param {string} selector
 *   A selector of what you wish to select on the page.
 * @param {string} value
 *   The value of what you wish to select.
 * @param {function} callback
 *   A function to be called when the item is selected.
 */
Zombie.prototype.select = function(selector, value, callback) {
  this.fill(selector, value, callback);
};

/**
 * Checks a checkbox.
 *
 * @param {string} selector
 *   A selector of what you wish to check.
 * @param {function} callback
 *   Called when the check has been performed.
 */
Zombie.prototype.check = function(selector, callback) {
  //TODO fix
  this._getPage(function(page) {
    page.evaluate(function(selector) {
      return phQuery(selector).attr('checked', 'checked').phNodes;
    }, function(error, nodes) {
      callback(error, nodes);
    }, selector);
  });
};

/**
 * Unchecks a checkbox on the page.
 *
 * @param {string} selector
 *   A selector of what you wish to uncheck.
 * @param {function} callback
 *   Called when the element has been unchecked.
 */
Zombie.prototype.uncheck = function(selector, callback) {
  //TODO fix
  this._getPage(function(page) {
    page.evaluate(function(selector) {
      return phQuery(selector).removeAttr("checked").phNodes;
    }, function(error, nodes) {
      callback(error, nodes);
    }, selector);
  });
};

/**
 * Chooses a radio element on the page.
 *
 * @param {string} selector
 *   The selector of what you wish to choose.
 * @param {function} callback
 *   Called when the element has been chosen.
 */
Zombie.prototype.choose = function(selector, callback) {
  this.check(selector, callback);
};

/**
 * Return the html of an item on the page.
 *
 * @param {type} selector
 * @param {type} context
 * @param {type} callback
 * @returns {undefined}
 */
Zombie.prototype.html = function(selector, context, callback) {
  if ((typeof callback === 'undefined') && (typeof context === 'undefined') && (typeof selector === 'function')) {
    callback = selector;
    selector = null;
    context = null;
  } else if ((typeof callback === 'undefined') && (typeof context === 'function')) {
    callback = context;
    context = null;
  }

  this.execute(function(args){
    if (args.selector == null) {
        var getDocTypeAsString = function () { 
          var node = document.doctype;
          return node ? "<!DOCTYPE "
           + node.name
           + (node.publicId ? ' PUBLIC "' + node.publicId + '"' : '')
           + (!node.publicId && node.systemId ? ' SYSTEM' : '') 
           + (node.systemId ? ' "' + node.systemId + '"' : '')
           + '>\n' : '';
        };    
        return getDocTypeAsString() + document.documentElement.outerHTML;
    } else {
        var element = args.context ? document.querySelector(args.context) : document;
        if(element)element = element.querySelector(args.selector);
        return element ? element.innerHTML : null;
    }
  }, callback, {
    selector: selector,
    context: context
  });
};

/**
 * Wait until expression is valid
 */
Zombie.prototype.until = function(expression, callback, param) {
  var self = this;
  var redo = function(){
    setTimeout(function(){
      self.until(expression, callback, param);      
    }, 50);
  };
  if(typeof expression === 'function'){
    function cb(error, result) {
      if(!result)redo();
      else callback();
    }
    this.execute(expression, cb, param);
  }else{
    this.evaluate(expression.toString(), function(result){
      if(!result)redo();
      else callback();
    });
  }
};

/**
 * Evaluate an expression and return the result.
 *
 * @param {type} expression
 * @param {type} callback
 * @returns {undefined}
 */
Zombie.prototype.evaluate = function(expression, callback) {
  this.execute(function(args) {
    return eval(args.expression);
  }, function(error, result) {
    callback(result);
  }, { expression: expression });
};

/**
 * Evaluates the CSS selector against the document (or context node) and return
 * array of nodes.
 *
 * @param {string} selector
 *   The sizzle selector of the nodes to retrieve.
 * @param {object} context
 *   The DOM context object to refine your query against.
 * @param {function} callback
 *   Called when the query has returned the nodes.
 */
Zombie.prototype.queryAll = function(selector, context, callback) {
  //TODO fix
  if ((typeof callback === 'undefined') && (typeof context === 'function')) {
    callback = context;
    context = null;
  }

  this._getPage(function(page) {
    page.evaluate(function(item) {
      return phQuery(item.selector, item.context).phNodes;
    }, function(error, nodes) {
      callback(nodes);
    }, {
      selector: selector,
      context: context
    });
  });
};

/**
 * Evaluates the CSS selector against the document (or context node) and
 * return an element.
 *
 * @param {type} selector
 * @param {type} context
 * @param {type} callback
 * @returns {undefined}
 */
Zombie.prototype.query = function(selector, context, callback) {
  //TODO fix
  if ((typeof callback === 'undefined') && (typeof context === 'function')) {
    callback = context;
    context = null;
  }

  this._getPage(function(page) {
    page.evaluate(function(item) {
      return phQuery(item.selector, item.context).phNodes;
    }, function(error, nodes) {
      callback(nodes ? nodes[0] : null);
    }, {
      selector: selector,
      context: context
    });
  });
};

/**
 * Returns the text contents of the selected element.
 *
 * @param {type} selector
 * @param {type} context
 * @param {type} callback
 * @returns {undefined}
 */
Zombie.prototype.text = function(selector, context, callback) {
  if ((typeof callback === 'undefined') && (typeof context === 'function')) {
    callback = context;
    context = null;
  }

  this.execute(function(args){
    var element = args.context ? document.querySelector(args.context) : document;
    if(element)element = element.querySelector(args.selector);
    return element ? element.innerText : null;
  },function(error, text) {
    callback(text);
  },{
    selector: selector,
    context: context
  });
};

/**
 * Evaluates the XPath expression against the document (or context node) and
 * return the XPath result.
 *
 * @param {string} expression
 *   An xpath expression.
 * @param {object} context
 *   The context to perform the xpath evaluate.
 */
Zombie.prototype.xpath = function(expression, context, callback) {
  //TODO fix
  if ((typeof callback === 'undefined') && (typeof context === 'function')) {
    callback = context;
    context = null;
  }

  this._getPage(function(page) {
    page.evaluate(function(item) {
      var context = isNaN(item.context) ? document : window.phNodes[item.context];
      var result = document.evaluate(item.expression, context);
      var nodes = [], node = null;
      while(node = result.iterateNext()) {
        nodes.push(window.phNodes.length);
        window.phNodes.push(node);
      }
      return nodes;
    }, function(error, nodes) {
      callback(nodes);
    }, {
      expression: expression,
      context: context
    });
  });
};

/**
 * Close the browser.
 */
Zombie.prototype.close = function() {
  if (this.phantomInstance) {
    this.phantomInstance.exit();
  }
};

// Add this class to the exports.
module.exports = Zombie;
