/* LD_PRELOAD shim for Ubuntu's blender 4.0.2 (+dfsg) package, whose Mantaflow registers its Python
 * module with PyImport_AppendInittab() lazily, i.e. after Py_Initialize().  Python 3.12 turns that
 * into a fatal error ("may not be called after Py_Initialize()"), so every fluid sim aborts Blender.
 * When the interpreter is already running we instead create the module right away and put it in
 * sys.modules under the same name, which is what the inittab entry would have done on import.
 *
 *   gcc -shared -fPIC -O2 $(python3.12-config --includes) -o manta_inittab_shim.so manta_inittab_shim.c -ldl $(python3.12-config --ldflags --embed)
 *   LD_PRELOAD=$PWD/manta_inittab_shim.so blender --background --python ...
 * (build_all.py does this automatically.)
 */
#define _GNU_SOURCE
#include <Python.h>
#include <dlfcn.h>

int PyImport_AppendInittab(const char *name, PyObject *(*initfunc)(void)) {
    if (Py_IsInitialized()) {
        PyGILState_STATE g = PyGILState_Ensure();
        PyObject *mods = PyImport_GetModuleDict();
        if (!PyDict_GetItemString(mods, name)) {
            PyObject *m = initfunc();
            if (m && PyModule_Check(m)) {
                PyDict_SetItemString(mods, name, m);
            } else if (m) {  /* multi-phase init: m is a PyModuleDef */
                PyObject *spec_name = PyUnicode_FromString(name);
                PyObject *mu = PyImport_ImportModule("importlib.machinery");
                PyObject *spec = mu ? PyObject_CallMethod(mu, "ModuleSpec", "OO", spec_name, Py_None) : NULL;
                PyObject *mod = spec ? PyModule_FromDefAndSpec((PyModuleDef *)m, spec) : NULL;
                if (mod) { PyModule_ExecDef(mod, (PyModuleDef *)m); PyDict_SetItemString(mods, name, mod); }
                Py_XDECREF(spec); Py_XDECREF(mu); Py_XDECREF(spec_name);
            }
            if (PyErr_Occurred()) PyErr_Print();
        }
        PyGILState_Release(g);
        return 0;
    }
    int (*real)(const char *, PyObject *(*)(void)) = dlsym(RTLD_NEXT, "PyImport_AppendInittab");
    return real(name, initfunc);
}
