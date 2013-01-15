/*!
 * TroopJS base component
 * @license TroopJS Copyright 2012, Mikael Karon <mikael@karon.se>
 * Released under the MIT license.
 */
/*global define:false */
define([ "../event/emitter" ], function ComponentModule(Emitter) {
	var COUNT = 0;
	var INSTANCE_COUNT = "instanceCount";

	var Component = Emitter.extend(function Component() {
		this[INSTANCE_COUNT] = COUNT++;
	}, {
		"instanceCount" : COUNT,
		"displayName" : "core/component"
	});

	/**
	 * Generates string representation of this object
	 * @returns Combination displayName and instanceCount
	 */
	Component.prototype.toString = function () {
		var self = this;

		return self.displayName + "@" + self[INSTANCE_COUNT];
	};

	return Component;
});
