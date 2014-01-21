/*
 * TroopJS core/event/emitter
 * @license MIT http://troopjs.mit-license.org/ © Mikael Karon mailto:mikael@karon.se
 */
define([
	"../object/base",
	"when",
	"poly/array"
], function EventEmitterModule(Base, when) {
	"use strict";

	/**
	 * The event module of TroopJS that provides common event handling capability, and some highlights:
	 *
	 * ## Asynchronous handlers
	 * Any event handler can be asynchronous depending on the **return value**:
	 *
	 *  - a Promise value makes this handler be considered asynchronous, where the next handler will be called
	 *  upon the completion of this promise.
	 *  - any non-Promise values make it a ordinary handler, where the next handler will be invoked immediately.
	 *
	 * ## Memorized emitting
	 * A fired event will memorize the "current" value of each event. Each executor may have it's own interpretation
	 * of what "current" means.
	 *
	 * For listeners that are registered after the event emitted thus missing from the call, {@link #reemit} will
	 * compensate the call with memorized data.
	 *
	 * @class core.event.emitter
	 * @extends core.object.base
	 */

	var UNDEFINED;
	var NULL = null;
	var DEFAULT = "default";
	var MEMORY = "memory";
	var CONTEXT = "context";
	var CALLBACK = "callback";
	var HEAD = "head";
	var TAIL = "tail";
	var NEXT = "next";
	var HANDLED = "handled";
	var HANDLERS = "handlers";
	var RUNNERS = "runners";
	var RE_RUNNER = /^(.+)(?::(\w+))/;
	var ARRAY_SLICE = Array.prototype.slice;

	/*
	 * Internal runner that executes candidates in sequence without overlap
	 * @private
	 * @param {Object} handlers List of handlers
	 * @param {Array} candidates Array of candidates
	 * @param {Number} handled Handled counter
	 * @param {Array} args Initial arguments
	 * @returns {Promise}
	 */
	function sequence(handlers, candidates, handled, args) {
		var results = [];
		var resultsCount = 0;
		var candidatesCount = 0;

		/*
		 * Internal function for sequential execution of candidates
		 * @private
		 * @param {Array} [result] result from previous handler callback
		 * @param {Boolean} [skip] flag indicating if this result should be skipped
		 * @return {Promise} promise of next handler callback execution
		 */
		var next = function (result, skip) {
			/*jshint curly:false*/
			var candidate;

			// Store result if no skip
			if (skip !== true) {
				results[resultsCount++] = result;
			}

			// Return promise of next callback, or a promise resolved with result
			return (candidate = candidates[candidatesCount++]) !== UNDEFINED
				? (candidate[HANDLED] = handled) === handled && when(candidate[CALLBACK].apply(candidate[CONTEXT], args), next)
				: (handlers[MEMORY] = args) === args && when.resolve(results);
		};

		return next(args, true);
	}

	return Base.extend(function EventEmitter() {
		this[HANDLERS] = {};
	}, {
		"displayName" : "core/event/emitter",

		"runners" : {
			"sequence": sequence,
			"default": sequence
		},

		/**
		 * Adds a listener for the specified event.
		 * @param {String} event The event name to subscribe to.
		 * @param {Object} context The context to scope callbacks to.
		 * @param {Function} callback The event listener function.
		 * @returns this
		 */
		"on" : function on(event, context, callback) {
			var me = this;
			var handlers = me[HANDLERS];
			var handler;

			// Get callback from next arg
			if (callback === UNDEFINED) {
				throw new Error("no callback provided");
			}

			// Have handlers
			if (event in handlers) {
				// Get handlers
				handlers = handlers[event];

				// Create new handler
				handler = {};

				// Set handler callback
				handler[CALLBACK] = callback;

				// Set handler context
				handler[CONTEXT] = context;

				// Set tail handler
				handlers[TAIL] = TAIL in handlers
					// Have tail, update handlers[TAIL][NEXT] to point to handler
					? handlers[TAIL][NEXT] = handler
					// Have no tail, update handlers[HEAD] to point to handler
					: handlers[HEAD] = handler;
			}
			// No handlers
			else {
				// Create event handlers
				handlers = handlers[event] = {};

				// Set HANDLED
				handlers[HANDLED] = 0;

				// Create head and tail
				handlers[HEAD] = handlers[TAIL] = handler = {};

				// Set handler callback
				handler[CALLBACK] = callback;

				// Set handler context
				handler[CONTEXT] = context;
			}

			return me;
		},

		/**
		 * Remove listener(s) from a subscribed event, if no listener is specified,
		 * remove all listeners of this event.
		 *
		 * @param {String} event The event that the listener subscribes to.
		 * @param {Object} [context] The context that bind to the listener.
		 * @param {Function} [callback] The event listener to remove.
		 * @returns this
		 */
		"off" : function off(event, context, callback) {
			var me = this;
			var handlers = me[HANDLERS];
			var handler;
			var head;
			var tail;

			// Have handlers
			if (event in handlers) {
				// Get handlers
				handlers = handlers[event];

				// Have HEAD in handlers
				if (HEAD in handlers) {
					// Get first handler
					handler = handlers[HEAD];

					// Iterate handlers
					do {
						// Should we remove?
						remove : {
							// If no context or context does not match we should break
							if (context && handler[CONTEXT] !== context) {
								break remove;
							}

							// If no callback or callback does not match we should break
							if (callback && handler[CALLBACK] !== callback) {
								break remove;
							}

							// Remove this handler, just continue
							continue;
						}

						// It there's no head - link head -> tail -> handler
						if (!head) {
							head = tail = handler;
						}
						// Otherwise just link tail -> tail[NEXT] -> handler
						else {
							tail = tail[NEXT] = handler;
						}
					}
						// While there's a next handler
					while ((handler = handler[NEXT]));

					// If we have both head and tail we should update handlers
					if (head && tail) {
						// Set handlers HEAD and TAIL
						handlers[HEAD] = head;
						handlers[TAIL] = tail;

						// Make sure to remove NEXT from tail
						delete tail[NEXT];
					}
					// Otherwise we remove the handlers list
					else {
						delete handlers[HEAD];
						delete handlers[TAIL];
					}
				}
			}

			return me;
		},

		/**
		 * Trigger an event which notifies each of the listeners in sequence of their subscribing,
		 * optionally pass data values to the listeners.
		 *
		 * @param {String} event The event name to emit
		 * @param {...*} [args] Data params that are passed to the listener function.
		 * @returns {Promise} promise Promise of the return values yield from the listeners at all.
		 */
		"emit" : function emit(event, args) {
			var me = this;
			var handlers = me[HANDLERS];
			var handler;
			var runners = me[RUNNERS];
			var runner = runners[DEFAULT];
			var candidates = [];
			var candidatesCount = 0;
			var matches;

			// Slice args
			args = ARRAY_SLICE.call(arguments, 1);

			// See if we should override event and runner
			if ((matches = RE_RUNNER.exec(event)) !== NULL) {
				event = matches[1];

				if ((runner = runners[matches[2]]) === UNDEFINED) {
					throw new Error("unknown runner " + matches[2]);
				}
			}

			// Have event in handlers
			if (event in handlers) {
				// Get handlers
				handlers = handlers[event];

				// Have HEAD in handlers
				if (HEAD in handlers) {
					// Get first handler
					handler = handlers[HEAD];

					// Step handlers
					do {
						// Push handler on candidates
						candidates[candidatesCount++] = handler;
					}
					// While there is a next handler
					while ((handler = handler[NEXT]));
				}
			}
			// No event in handlers
			else {
				// Create handlers and store with event
				handlers[event] = handlers = {};

				// Set handled
				handlers[HANDLED] = 0;
			}

			// Return promise
			return runner.call(me, handlers, candidates, ++handlers[HANDLED], args);
		},

		/**
		 * Re-emit any event that are **previously triggered**, any (new) listeners will be called with the memorized data
		 * from the previous event emitting procedure.
		 *
		 * 	// start widget1 upon the app loaded.
		 * 	app.on('load', function(url) {
		 * 		widget1.start(url);
		 * 	});
		 *
		 * 	// Emits the load event on app.
		 * 	app.emit('load', window.location.hash);
		 *
		 * 	// start of widget2 comes too late for the app start.
		 * 	app.on('load', function(url) {
		 * 		// Widget should have with the same URL as with widget1.
		 * 		widget2.start(url);
		 * 	});
		 *
		 * 	$.ready(function() {
		 * 		// Compensate the "load" event listeners that are missed.
		 * 		app.reemit();
		 * 	});
		 *
		 * @param {String} event The event name to re-emit, dismiss if it's the first time to emit this event.
		 * @param {Boolean} senile=false Whether to trigger listeners that are already handled in previous emitting.
		 * @param {Object} [context] The context object to match.
		 * @param {Function} [callback] The listener function to match.
		 * @returns {Promise}
		 */
		"reemit" : function reemit(event, senile, context, callback) {
			var me = this;
			var handlers = me[HANDLERS];
			var handler;
			var handled;
			var runners = me[RUNNERS];
			var runner = runners[DEFAULT];
			var candidates = [];
			var candidatesCount = 0;
			var matches;

			// See if we should override event and runner
			if ((matches = RE_RUNNER.exec(event)) !== NULL) {
				event = matches[1];

				if ((runner = runners[matches[2]]) === UNDEFINED) {
					throw new Error("unknown runner " + matches[2]);
				}
			}

			// Have event in handlers
			if (event in handlers) {
				// Get handlers
				handlers = handlers[event];

				// Get handled
				handled = handlers[HANDLED];

				if (HEAD in handlers) {
						// Get first handler
					handler = handlers[HEAD];

					// Iterate handlers
					do {
						add : {
							// If no context or context does not match we should break
							if (context && handler[CONTEXT] !== context) {
								break add;
							}

							// If no callback or callback does not match we should break
							if (callback && handler[CALLBACK] !== callback) {
								break add;
							}

							// If we are already handled and not senile break add
							if (handler[HANDLED] === handled && !senile) {
								break add;
							}

							// Push handler on candidates
							candidates[candidatesCount++] = handler;
						}
					}
						// While there's a next handler
					while ((handler = handler[NEXT]));
				}
			}
			// No event in handlers
			else {
				// Create handlers and store with event
				handlers[event] = handlers = {};

				// Set handled
				handlers[HANDLED] = handled = 0;
			}

			// Return promise
			return runner.call(me, handlers, candidates, handled, handlers[MEMORY]);
		},

		/**
		 * Returns value in handlers MEMORY
		 * @param {String} event to peek at
		 * @returns {*} Value in MEMORY
		 */
		"peek": function peek(event) {
			var me = this;
			var handlers = me[HANDLERS];
			var result;

			if (event in handlers) {
				handlers = handlers[event];

				if (MEMORY in handlers) {
					result  = handlers[MEMORY];
				}
			}

			return result;
		}
	});
});
